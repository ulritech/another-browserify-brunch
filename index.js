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
 *
 * Due to a bug in gulp-uglify, the compressor when used in conjunction with sourcemaps prevents
 * breakpoints from working properly in chrome devtools. For the time being, we disable the compressor
 * if sourcemaps is enabled. 
 * See: https://github.com/terinjokes/gulp-uglify/issues/64
 */
'use strict';

var fs = require('fs'),
	path = require('path');

var chalk = require('chalk'),
	mkdirp = require('mkdirp'),
	browserify = require('browserify'),
	watchify = require('watchify'),
	touch = require('touch'),

	uglify = require('gulp-uglify'),
	gulp = require('gulp'),
	rename = require('gulp-rename'),
	buffer = require('vinyl-buffer'),
	source = require('vinyl-source-stream'),
	sourcemaps = require('gulp-sourcemaps');

function AnotherBrowserifyBrunchPlugin(brunchConfig) {
	this.brunchConfig_ = brunchConfig;
	this.config_ = brunchConfig.plugins.anotherBrowserify;

	this.entryFile_ = path.resolve(this.config_.entry);
	this.gulpDestDir_ = path.resolve(brunchConfig.paths['public']);
	this.outFile_ = path.resolve(brunchConfig.paths['public'], this.config_.outFile);
	this.uglifyOptions_ = this.config_.uglifyOptions || {};

	// gulp-uglify bug workaround; see notes at top of page
	if (brunchConfig.sourceMaps && !('compress' in this.uglifyOptions_))
		this.uglifyOptions_.compress = false;

	// This is necessary to tell gulp what the correct output file is
	var extension = path.extname(this.config_.outFile);
	this.gulpRenameOptions_ = {
		dirname: path.dirname(this.config_.outFile),
		basename: path.basename(this.config_.outFile, extension),
		extname: extension
	};

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

	var flow = bundle.pipe(source(this.entryFile_));
	flow = flow.pipe(buffer());

	if (this.brunchConfig_.sourceMaps)
		flow = flow.pipe(sourcemaps.init({loadMaps: true}));

	// Any custom user pipes - squashed between the source maps option
	if (this.config_.gulpPipeCreateFns) {
		if (!(this.config_.gulpPipeCreateFns instanceof Array))
			throw new Error('AnotherBrowserify: \'gulpPipeCreateFns\' configuration variable must be an array of functions that each return a newly instantiated gulp plugin');

		this.config_.gulpPipeCreateFns.forEach(function(gulpPipeCreateFn, i) {
			if (!(gulpPipeCreateFn instanceof Function))
				throw new Error('AnotherBrowserify: \'gulpPipeCreateFns[' + i + ']\' must be a function');
			flow = flow.pipe(gulpPipeCreateFn());
		});
	}

	if (this.brunchConfig_.optimize)
		flow = flow.pipe(uglify(this.uglifyOptions_));

	flow = flow.pipe(rename(this.gulpRenameOptions_));
	// Set in constructor   ^^^^^^^^^^^^^^^^^^^^^^^

	if (this.brunchConfig_.sourceMaps)
		flow = flow.pipe(sourcemaps.write('.'));

	flow.pipe(gulp.dest(this.gulpDestDir_))
		.on('finish', function() {
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
					console.log('\tCompiled:', chalk.underline(friendlyName), 'in', ms + 'ms');
				}
			}

			if (self.config_.touchOnCompile) {
				touch.sync(path.resolve(self.config_.touchOnCompile));
				console.log('\tTriggering browser reload');
			}
		});
};

AnotherBrowserifyBrunchPlugin.prototype.teardown = function() {
	if (this.watching_)
		this.bundler_.close();
};

function shortFileName(fileName) {
	return stripFromBeginning(fileName, process.cwd() + path.sep);
}

function stripFromBeginning(subject, query) {
	if (!query)
		return subject;

	if (subject.indexOf(query) === 0)
		return subject.substr(query.length);

	return subject;
}

module.exports = AnotherBrowserifyBrunchPlugin;
