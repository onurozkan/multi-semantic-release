const { filterAffected } = require("nx/src/project-graph/affected/affected-project-graph");
const { readNxJson } = require("nx/src/generators/utils/nx-json");
const { createProjectGraphAsync, ProjectGraph } = require("nx/src/project-graph/project-graph");
const { calculateFileChanges } = require("nx/src/project-graph/file-utils");
const { pruneExternalNodes } = require("nx/src/project-graph/operators");
const { parseFiles } = require("nx/src/utils/command-line-utils");
const { workspaceRoot } = require("nx/src/utils/workspace-root");
const cleanPath = require("./cleanPath");
const { FsTree } = require("nx/src/generators/tree");
const { getNpmScope } = require("@nx/js/internal");

const readJsonFile = (fPath) => require(fPath);

/**
 * Generates scoped package name
 * @param {string} npmScope scope
 * @param {string} projectName name
 * @returns {string} scoped package name
 */
const createScopedPackageName = (npmScope, projectName) => `@${npmScope}/${projectName}`;

/**
 * Creates a package.json in the output directory for support to install dependencies within containers.
 * If a package.json exists in the project, it will reuse that.
 *
 * @param {string} projectName Nx project name
 * @param {ProjectGraph} graph dependency graph
 * @param {Object} options additional options for projectRoot, root and npmScope
 * @returns {PackageJson} Metadata for package.json
 */
function createPackageJson(projectName, graph, options) {
	const { projectRoot, root, npmScope } = options;
	const npmDeps = findAllNpmDeps(projectName, graph);

	// default package.json if one does not exist
	let packageJson = {
		name: createScopedPackageName(npmScope, projectName),
		version: "0.0.0",
		dependencies: {},
		devDependencies: {},
	};
	try {
		packageJson = readJsonFile(`${projectRoot}/package.json`);
		if (!packageJson.dependencies) {
			packageJson.dependencies = {};
		}
		if (!packageJson.devDependencies) {
			packageJson.devDependencies = {};
		}
		// eslint-disable-next-line no-empty
	} catch (e) {}

	const rootPackageJson = readJsonFile(`${root}/package.json`);
	Object.entries(npmDeps).forEach(([packageName, version]) => {
		if (rootPackageJson.devDependencies && rootPackageJson.devDependencies[packageName]) {
			packageJson.devDependencies[packageName] = version;
		} else {
			packageJson.dependencies[packageName] = version;
		}
	});

	return packageJson;
}

/**
 * Finds all the NPM package dependencies using the project graph.
 *
 * @param {string} projectName Nx project name
 * @param {Object} graph dependency graph
 * @param {Object} list mutable list to maintain dependencies
 * @param {Object} seen cache to mark processed
 * @returns {Object} final list contains resolved dependencies
 */
function findAllNpmDeps(projectName, graph, list = {}, seen = new Set()) {
	if (seen.has(projectName)) {
		return list;
	}

	seen.add(projectName);

	const node = graph.nodes[projectName] || graph.externalNodes[projectName];

	if (node && node.type === "npm") {
		list[node.data.packageName] = node.data.version;
		recursivelyCollectPeerDependencies(node.name, graph, list);
	}

	if (graph.dependencies[projectName]) {
		graph.dependencies[projectName].forEach((dep) => {
			findAllNpmDeps(dep.target, graph, list, seen);
		});
	}

	return list;
}

/**
 * Collect peer dependencies
 *
 * @param {string} projectName Nx project name
 * @param {Object} graph dependency graph
 * @param {Object} list mutable list to maintain dependencies
 * @param {Object} seen cache to mark processed
 * @returns {Object} final list contains resolved dependencies
 */
function recursivelyCollectPeerDependencies(projectName, graph, list = {}, seen = new Set()) {
	if (!graph.nodes[projectName] || graph.nodes[projectName].type !== "npm" || seen.has(projectName)) {
		return list;
	}

	seen.add(projectName);
	const packageName = graph.nodes[projectName].data.packageName;
	try {
		const packageJson = require(`${packageName}/package.json`);
		if (!packageJson.peerDependencies) {
			return list;
		}

		Object.keys(packageJson.peerDependencies)
			.map((dependencyName) => `npm:${dependencyName}`)
			.map((dependency) => graph.nodes[dependency])
			.filter(Boolean)
			.forEach((node) => {
				list[node.data.packageName] = node.data.version;
				recursivelyCollectPeerDependencies(node.name, graph, list, seen);
			});
		return list;
	} catch (e) {
		return list;
	}
}

/**
 * Returns a new project graph containing subsetNodes plus every node reachable from them,
 * keeping only the dependency edges between nodes that stay in the graph.
 *
 * Nx dropped this helper from `nx/src/project-graph/operators` in v21+, so it is reimplemented
 * here (unchanged from the nx <=20 behaviour) to keep this module dependency-free of internals
 * that no longer exist.
 *
 * @param {ProjectGraph} original dependency graph to walk
 * @param {Object[]} subsetNodes nodes to start the walk from
 * @returns {Object} graph restricted to subsetNodes and their transitive dependencies
 */
function withDeps(original, subsetNodes) {
	const res = { nodes: {}, dependencies: {} };
	const visitedNodes = [];
	const visitedEdges = [];

	Object.values(subsetNodes).forEach(recurNodes);
	Object.values(subsetNodes).forEach(recurEdges);

	return res;

	function recurNodes(node) {
		if (visitedNodes.indexOf(node.name) > -1) return;

		res.nodes[node.name] = node;
		if (!res.dependencies[node.name]) {
			res.dependencies[node.name] = [];
		}
		visitedNodes.push(node.name);

		original.dependencies[node.name].forEach((n) => {
			if (original.nodes[n.target]) {
				recurNodes(original.nodes[n.target]);
			}
		});
	}

	function recurEdges(node) {
		if (visitedEdges.indexOf(node.name) > -1) return;

		visitedEdges.push(node.name);
		const ds = original.dependencies[node.name];
		ds.forEach((n) => {
			if (!original.nodes[n.target]) {
				return;
			}
			if (!res.dependencies[n.source]) {
				res.dependencies[n.source] = [];
			}
			res.dependencies[n.source].push(n);
		});
		ds.forEach((n) => {
			if (original.nodes[n.target]) {
				recurEdges(original.nodes[n.target]);
			}
		});
	}
}

/**
 * Details about source package
 * @typedef SourceManifest
 * @param {string} dir Dirname for path to load package details.
 * @param {PackageJSON} manifest Deserialised content of the package.json
 */

/**
 * @typedef DetermineOptions
 * @param {boolean} [onlyAffected=true] Process only affected packages
 * @param {string} [cwd=process.cwd()] Current working directory
 * @param {string} [npmScope] Explicit npm scope for generated package names. Overrides autodetection.
 */

/**
 * Resolves the npm scope used to build package names.
 *
 * Nx dropped the `npmScope` field from nx.json in v17, so it is resolved in order of
 * decreasing explicitness. The released package name — and therefore the git tag
 * semantic-release looks up — is derived from this, so an existing workspace must keep
 * resolving to the same value it used before the upgrade.
 *
 * @param {Tree} tree Nx virtual filesystem tree
 * @param {NxJsonConfiguration} nxJson Deserialised nx.json
 * @param {string} [explicitScope] Scope passed by the caller
 * @returns {string} npm scope without the leading `@`
 */
function resolveNpmScope(tree, nxJson, explicitScope) {
	// 1. Caller-provided, 2. legacy nx.json field (nx <17), 3. root package.json scope (nx >=17)
	const resolved = explicitScope || nxJson.npmScope || getNpmScope(tree);
	if (resolved) return resolved;

	// getNpmScope only returns a value for a scoped root package.json. Fall back to the bare
	// root name, stripping any scope so we never build a doubly-scoped `@@scope/name/project`.
	const rootName = readJsonFile(`${workspaceRoot}/package.json`).name || "";
	return rootName.startsWith("@") ? rootName.split("/")[0].substring(1) : rootName;
}

/**
 * Determines Nx.dev packages using nx's internal workspace tooling and dependency graph.
 *
 * @param {DetermineOptions} options Options for processing graph
 * @returns {SourceManifest[]} Returns list of source manifest for the workspace
 */
async function determineNxPackages({ onlyAffected = true, cwd = process.cwd(), npmScope } = {}) {
	const tree = new FsTree(workspaceRoot, true);
	const nxJson = readNxJson(tree);
	const scope = resolveNpmScope(tree, nxJson, npmScope);

	// `affected.defaultBase` was flattened to `defaultBase` in nx 17.
	const gitArgs = { base: nxJson.defaultBase || (nxJson.affected && nxJson.affected.defaultBase) || "master" };

	let projectGraph = await createProjectGraphAsync();

	if (onlyAffected) {
		// nx 21+: calculateFileChanges dropped its allWorkspaceFiles argument (it now hashes files itself).
		const touchedFiles = calculateFileChanges(parseFiles(gitArgs).files, gitArgs);
		projectGraph = await filterAffected(projectGraph, touchedFiles, nxJson);
	}

	const projects = pruneExternalNodes(withDeps(projectGraph, Object.values(projectGraph.nodes))).nodes;

	const packageManifests = Object.entries(projects).reduce((allPackages, [key, project]) => {
		const manifest = createPackageJson(project.name, projectGraph, {
			projectRoot: project.data.sourceRoot,
			root: workspaceRoot,
			npmScope: scope,
		});

		return {
			...allPackages,
			[key]: manifest,
		};
	}, {});

	const packagesWithInternalDeps = Object.entries(projectGraph.dependencies).reduce((allPackages, [key, deps]) => {
		const manifest = allPackages[key];
		if (!deps || !deps.length || !manifest) {
			return allPackages;
		}

		const newDependencies = deps.reduce((depedencies, { target }) => {
			return {
				...depedencies,
				[createScopedPackageName(scope, target)]: "*",
			};
		}, manifest.dependencies);

		const newManifest = {
			...manifest,
			dependencies: newDependencies,
		};

		return {
			...allPackages,
			[key]: newManifest,
		};
	}, packageManifests);

	const affectedPackagesToRelease = Object.entries(packagesWithInternalDeps).reduce(
		(appPackages, [key, manifest]) => {
			const affected = projects[key];

			// Make path absolute.
			const dir = cleanPath(affected.data.root, cwd);

			return {
				...appPackages,
				[key]: {
					manifest,
					dir,
				},
			};
		},
		{}
	);

	return Object.values(affectedPackagesToRelease);
}

module.exports.determineNxPackages = determineNxPackages;
