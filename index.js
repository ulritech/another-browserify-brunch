/**
 * Brunch plugin that does the following:
 * - Browserify / watchify
 * - Sourcemaps
 * - Minification
 * - Incremental rebuild
 *
 * To indicate that a compile has completed, specify a file via touchOnCompile
 * that will be touched after the bundle has finished. This may be used to trigger
 * an autoreload (e.g. auto-reload-brunch) if desired.
 */
'use strict';

var fs = require('fs'),
	path = require('path');

var chalk = require('chalk'),
	mkdirp = require('mkdirp'),
	browserify = require('browserify'),
	watchify = require('watchify'),
	exorcist = require('exorcist'),
	uglifyify = require('uglifyify'),
	touch = require('touch');

function AnotherBrowserifyBrunchPlugin(brunchConfig) {
	this.brunchConfig_ = brunchConfig;
	this.config_ = brunchConfig.plugins.anotherBrowserify;

	this.outFile_ = path.resolve(brunchConfig.paths['public'], this.config_.outFile);
	this.outMapFile_ = path.resolve(brunchConfig.paths['public'], this.config_.mapFile);

	this.watching_ = false;
	for (var i=0; i<process.argv.length; i++) {
		if (process.argv[i] === 'watch') {
			this.watching_ = true;
			break;
		}
	}

	var bOptions = {
		extensions: ['.js', '.es6']
	};

	for (var key in this.config_.browserifyOptions)
		bOptions[key] = this.config_.browserifyOptions[key];

	// Required flags that depend on the brunch configuration
	if (brunchConfig.sourceMaps)
		bOptions.debug = true;

	if (this.watching_) {
		bOptions.cache = {};
		bOptions.packageCache = {}
	}

	this.bundler_ = this.browserify_ = browserify(bOptions);
	if (this.watching_)
		this.bundler_ = this.watchify_ = watchify(this.browserify_);

	if (this.config_.transforms) {
		var self = this;
		this.config_.transforms.forEach(function(tr) {
			self.bundler_.transform(tr);
		});
	}

	if (brunchConfig.optimize)
		this.bundler_.transform(uglifyify, {global: true});

	this.browserify_.add(this.config_.entry);

	mkdirp.sync(path.dirname(this.outFile_));

	if (this.watchify_)
		this.watchify_.on('update', this.bundle.bind(this));

	this.bundle();
}

AnotherBrowserifyBrunchPlugin.prototype.brunchPlugin = true;

AnotherBrowserifyBrunchPlugin.prototype.bundle = function(changedFiles) {
	var self = this,
		beginTime = process.hrtime(),
		multipleFilesChanged = changedFiles && changedFiles.length > 1;

	if (multipleFilesChanged)
		console.log('\nStart', chalk.cyan('bundling'));

	var bundle = this.bundler_.bundle();
	bundle.on('error', function(error) {
		console.error(chalk.red(chalk.red(error.toString())));
	});
	if (this.brunchConfig_.sourceMaps)
		bundle = bundle.pipe(exorcist(this.outMapFile_));

	bundle.pipe(fs.createWriteStream(this.outFile_))
		.on('finish', function() {
			if (self.config_.touchOnCompile)
				touch.sync(path.resolve(self.config_.touchOnCompile));

			var endTime = process.hrtime(),
				seconds = endTime[0] - beginTime[0],
				nanoseconds = endTime[1] - beginTime[1],
				ms = Math.floor(seconds * 1000 + nanoseconds / 1000000);

			if (changedFiles) {
				if (multipleFilesChanged) {
					changedFiles.forEach(function(changedFile) {
						var friendlyName = shortFileName(changedFile);
						console.log('\tCompiled:', chalk.underline(friendlyName));
					});
					console.log('Finished', chalk.cyan('bundle'), 'in', ms + 'ms\n');
				}
				else {
					var friendlyName = shortFileName(changedFiles[0]);
					console.log('\nCompiled:', chalk.underline(friendlyName), 'in', ms + 'ms');
				}
			}
		});
};

AnotherBrowserifyBrunchPlugin.prototype.teardown = function() {
	if (this.watching_)
		this.bundler_.close();
};

function shortFileName(fileName) {
	return stripFromBeginning(fileName, process.cwd() + '/');
}

function stripFromBeginning(subject, query) {
	if (!query)
		return subject;

	if (subject.indexOf(query) === 0)
		return subject.substr(query.length);

	return subject;
}

module.exports = AnotherBrowserifyBrunchPlugin;
