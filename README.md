# @creaworks/multi-semantic-release


Best [semantic-release](https://github.com/semantic-release/semantic-release) solution for [nx.dev](https://github.com/nrwl/nx) monorepo projects.

This fork of [qiwi/multi-semantic-release](https://github.com/qiwi/multi-semantic-release) introduces releasing support for nx.dev workspaces using underlying "affected" mechanism.

## Install

```sh
yarn add @creaworks/multi-semantic-release --dev
```

## Usage

```sh
multi-semantic-release
```

CLI flag options:

```sh
  Options
    --dry-run Dry run mode.
    --debug Output debugging information.
    --sequential-init  Avoid hypothetical concurrent initialization collisions.
    --first-parent Apply commit filtering to current branch only.
		--ignore-packages  Packages list to be ignored on bumping process (append to the ones that already exist at package.json workspaces)
    --deps.bump Define deps version updating rule. Allowed: override, satisfy, inherit.
		--deps.release Define release type for dependent package if any of its deps changes. Supported values: patch, minor, major, inherit.
		--only-affected Releases the affected packages. Available for Nx.dev only. (default: true)
    --help Help info.

  Examples
  $ multi-semantic-release --debug
	$ multi-semantic-release --deps.bump=satisfy --deps.release=patch
	$ multi-semantic-release --ignore-packages=packages/a/**,packages/b/**
```

## Configuration
**MSR** requires **semrel** config to be added [in any supported format](https://github.com/semantic-release/semantic-release/blob/master/docs/usage/configuration.md#configuration) for each package or/and declared in repo root (`globalConfig` is extremely useful if all the modules have the same strategy of release).  
NOTE config resolver joins `globalConfig` and `packageConfig` during execution.
```javascript
// Load the package-specific options.
const { options: pkgOptions } = await getConfig(dir);

// The 'final options' are the global options merged with package-specific options.
// We merge this ourselves because package-specific options can override global options.
const finalOptions = Object.assign({}, globalOptions, pkgOptions);
```
