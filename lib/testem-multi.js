/**
* testem-multi
*
* @author sideroad
*/
var testemAPI = require('testem');
var async = require('async');
var _ = require('underscore');
var fs = require('fs');
var BaseReporter = require('./reporter');
var Readable = require('stream').Readable;
var util = require('util');
var events = require('events');
var path = require('path');
var mkdirp = require('mkdirp');
var coverage = require('./coverage_middleware');
var bodyParser = require('body-parser');

(function(){
  "use strict";

  var Runner = function (config) {
    this.config = _.clone(config);
    delete this.config.files;
    this.output = _.extend({}, {
      // report passed tests
      pass: true,
      // report failed tests
      fail: true,
      // where to write the coverage report
      coverage: false
    }, config.output);

    if (this.output.coverage) {
      mkdirp.sync(this.output.coverage);
    }

    this.results = {
      test: [],
      ok: [],
      not : [],
      tests : 0,
      pass : 0,
      fail : 0,
      version : ""
    };
    this.tap = {
      ok: [],
      not: [],
      all: [],
      comments: []
    };

    this.bailedOut = false;

    this.stream = new Readable();
    this.stream._read = function () {};

    this.lastTestNumber = 0;

    events.EventEmitter.call(this);
  };

  util.inherits(Runner, events.EventEmitter);

  Runner.prototype.getConfig = function (extend) {
    var options = this.config;
    if (extend) {
      if(/\.json$/.test(extend)) {
        options = _.extend(this.config, JSON.parse(fs.readFileSync(extend, 'utf-8').replace(/\n/,'')));
      } else {
        options = _.extend(this.config, {test_page: extend + "#testem"});
      }
    }
    return options;
  };

  Runner.prototype.fullResult = function (data, path) {
    this.results.test = this.results.test.concat(data.test.map(prefixPath));
    this.results.ok = this.results.ok.concat(data.ok.map(prefixPath));
    this.results.not = this.results.not.concat(data.not.map(prefixPath));
    this.results.pass += data.pass;
    this.results.fail += data.fail;
    this.results.tests += data.tests;

    function prefixPath (item) {
      return path + " - " + item;
    }
  };

  Runner.prototype.createResult = function () {
    var tapResult = [
      "# Using testem " + require(__dirname + "/../node_modules/testem/package.json").version
    ];

    var tap = this.tap, tests = tap.all.length;

    if (!this.output.pass && this.output.fail) {
      tapResult.push("# Failing tests", tap.not.join('\n'));
    } else if(this.output.pass && !this.output.fail) {
      tapResult.push("# Passing tests", tap.ok.join('\n'));
    } else if(this.output.pass && this.output.fail) {
      tapResult.push("# Whole list of tests", tap.all.join('\n'));
    }

    if (tap.comments.length) {
      tapResult.push(tap.comments.join('\n'));
    }
    tapResult.push("");
    tapResult.push("1.." + tests);
    tapResult.push("# tests " + tests );
    tapResult.push("# pass " + tap.ok.length );
    tapResult.push("# fail " + tap.not.length );


    var result = tapResult.join("\n");
    this.stream.push(result);
    this.stream.push(null);
    return {
      text: result,
      details: this.results,
      tapdetails: tap
    };
  };

  Runner.prototype.testResult = function (test, path) {
    if (!test.ok && this.config.bailOut) {
      // Next tests will be skipped
      this.bailedOut = true;
    }
    var prefix = test.ok ? "ok" : "not ok";
    var name = path + " - " + test.name;
    this.lastTestNumber += 1;
    var tapline = prefix + " " + this.lastTestNumber + " " + name;

    this.tap.all.push(tapline);
    if (test.ok) {
      this.tap.ok.push(tapline);
    } else {
      this.tap.not.push(tapline);
    }

    this.stream.push(tapline + "\n");
    this.emit("data", prefix + " " + name);
  };

  var running;
  exports.exec = function (config, jsonFile) {
    var json = jsonFile || "testem-multi.json",
      config = config || JSON.parse( fs.readFileSync(json, "utf-8").replace(/\n/,'')),
      files = config.files || [''];

    running = new Runner(config);

    // Make this method async and give time to register event listeners
    process.nextTick(function () {
      async.reduce(
        files,
        running,
        executeTest,
        wrapUp
      );
    });

    return running;
  };

  // Expose also the on method, it would be nicer not to do it :P
  exports.on = function () {
    if (running) {
      running.on.apply(running, arguments);
    }
  };


  function executeTest (runner, path, callback) {
    if (runner.bailedOut) {
      var message = "# BAILED OUT: Skipping " + path;
      runner.tap.comments.push(message);
      runner.stream.push(message + "\n");
      runner.emit("data", message);
      return callback(null, runner);
    }
    var options = runner.getConfig(path),
        testemPath = 'testem.'+(new Date().getTime())+'.'+Math.random()+'.json';
    fs.writeFileSync(testemPath, JSON.stringify(options));
    runner.stream.push("# Executing " + path + "\n");
    runner.emit("data", "# Executing " + path);

    var handleException = function (ex) {
      console.error("Unchaught Expection while running Testem Multi", ex);
      fs.unlinkSync(testemPath);
    };

    startTestem(runner, testemPath, path, function (error, runner) {
      fs.unlinkSync(testemPath);
      process.removeListener('uncaughtException', handleException);
      callback(error, runner);
    });

    process.once('uncaughtException', handleException);
  }

  function startTestem (runner, configFile, path, callback) {
    var testem = new testemAPI();
    var reporter = new BaseReporter(runner.output);
    var done = getCallback(callback, runner);

    reporter.on("finish", function (data) {
      runner.fullResult(data, path);

      done(null);
    });

    reporter.on("test", function (data) {
      runner.testResult(data, path);
    });

    // Handle connection reset errors (raised since node 0.10)
    var middlewares = [function (err, req, res, next) {
      if (err && err.code === "ECONNRESET") {
        // Ignore this error
        next();
      } else {
        // Propagate it
        next(err);
      }
    }];

    if (runner.output.coverage) {
      middlewares.push(coverage.testem, coverage.store.bind(runner));

      // Hack into the server object to add middlewares
      var Server = require("../node_modules/testem/lib/server/index.js");
      var testem_configureExpress = Server.prototype.configureExpress;
      Server.prototype.configureExpress = function () {
        testem_configureExpress.apply(this, arguments);

        // After configuring the basic options, add our custom middlewares
        this.express.use(coverage.testem);
        this.express.use(bodyParser.urlencoded({ extended: false }));
        this.express.use(bodyParser.json());
        this.express.use(coverage.store.bind(runner));
      };
    }

    testem.startCI({
      file: configFile,
      reporter: reporter
    }, function () {
      reporter.removeAllListeners("test");
      reporter.removeAllListeners("finish");
      done(null);
    });
  }

  function wrapUp (err, runner) {
    var result = runner.createResult();
    runner.emit("exit", result.text, result.details);
  }

  // Generate a callback that must be called twice before actually calling back
  // This is needed to synchronize testem and reporter
  function getCallback (callback, runner) {
    var counter = 1;
    var back = function (err) {
      if (counter === 0) {
        callback(err, runner);
      } else {
        counter -= 1;
      }
    };
    return back;
  }

})();
