const path = require("path");
const fs = require("fs");

const resolveArguments = ({ cwd, ignorePackages, onlyAffected }) => {
	if (fs.existsSync(path.join(cwd, "nx.json"))) {
		console.log("found nx.json, trying to resolve project packages...");

		const nxWorkspace = require("../lib/nxWorkspace");
		const packageManifests = nxWorkspace.determineNxPackages({ cwd, onlyAffected });

		return {
			packageManifests,
		};
	}

	const getPackagePaths = require("../lib/getPackagePaths");
	// Get list of package.json paths according to workspaces.
	const paths = getPackagePaths(cwd, ignorePackages);
	console.log("package paths", paths);

	return {
		paths,
	};
};

module.exports = (flags) => {
	if (flags.debug) {
		require("debug").enable("msr:*");
	}

	// Imports.
	const multiSemanticRelease = require("../lib/multiSemanticRelease");
	const multisemrelPkgJson = require("../package.json");
	const semrelPkgJson = require("semantic-release/package.json");

	// Get directory.
	const cwd = process.cwd();

	// Catch errors.
	try {
		console.log(`multi-semantic-release version: ${multisemrelPkgJson.version}`);
		console.log(`semantic-release version: ${semrelPkgJson.version}`);
		console.log(`flags: ${JSON.stringify(flags, null, 2)}`);

		const inputArguments = resolveArguments({
			cwd,
			ignorePackages: flags.ignorePackages,
			onlyAffected: flags.onlyAffected,
		});

		// Do multirelease (log out any errors).
		multiSemanticRelease(inputArguments, {}, { cwd }, flags).then(
			() => {
				// Success.
				process.exit(0);
			},
			(error) => {
				// Log out errors.
				console.error(`[multi-semantic-release]:`, error);
				process.exit(1);
			}
		);
	} catch (error) {
		// Log out errors.
		console.error(`[multi-semantic-release]:`, error);
		process.exit(1);
	}
};
