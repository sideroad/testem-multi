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
var ua_parser = require('ua-parser');
var mkdirp = require('mkdirp');
var path = require('path');

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

  Runner.prototype.fullResult = function (data) {
    this.results.test = this.results.test.concat(data.test);
    this.results.ok = this.results.ok.concat(data.ok);
    this.results.not = this.results.not.concat(data.not);
    this.results.pass += data.pass;
    this.results.fail += data.fail;
    this.results.tests += data.tests;
  };

  Runner.prototype.createResult = function () {
    var tapResult = [
      "# Using testem " + require(__dirname + "/../node_modules/testem/package.json").version
    ];

    var tests = this.results.tests,
      pass = this.results.pass,
      ok = this.results.ok,
      fail = this.results.fail,
      not = this.results.not,
      test = this.results.test;

    if (!this.output.pass && this.output.fail) {
      tapResult.push("# Failing tests\nnot ok " + not.join('\nnot ok '));
    } else if(this.output.pass && !this.output.fail) {
      tapResult.push("# Passing tests\nok " + ok.join('\nok '));
    } else if(this.output.pass && this.output.fail) {
      tapResult.push("# Whole lists of tests");
      if (ok.length > 0) {
        tapResult.push("ok " + ok.join('\nok '));
      }
      if (not.length > 0) {
        tapResult.push("not ok " + not.join('\nnot ok '));
      }
    }
    tapResult.push("");
    tapResult.push("1.." + tests);
    tapResult.push("# tests " + tests );
    tapResult.push("# pass " + pass );
    tapResult.push("# fail " + fail );


    var result = tapResult.join("\n");
    this.stream.push(result);
    this.stream.push(null);
    return {
      text: result,
      details: this.results
    };
  };

  Runner.prototype.testResult = function (test) {
    var prefix = test.ok ? "ok" : "not ok";
    this.lastTestNumber += 1;
    this.stream.push(prefix + " " + this.lastTestNumber + " - " + test.name + "\n");
    this.emit("data", prefix + " " + test.name);
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
  }


  function executeTest (runner, path, callback) {
    var options = runner.getConfig(path),
        testemPath = 'testem.'+(new Date().getTime())+'.'+Math.random()+'.json';
    fs.writeFileSync(testemPath, JSON.stringify(options));
    runner.stream.push("# Executing " + path + "\n");
    runner.emit("data", "# Executing " + path);

    var handleException = function (ex) {
      console.error("Unchaught Expection while running Testem Multi", ex);
      fs.unlinkSync(testemPath);
    };

    startTestem(runner, testemPath, function (error, runner) {
      fs.unlinkSync(testemPath);
      process.removeListener('uncaughtException', handleException);
      callback(error, runner);
    });

    process.once('uncaughtException', handleException);
  }

  function startTestem (runner, configFile, callback) {
    var testem = new testemAPI();
    var reporter = new BaseReporter(runner.output);
    var done = getCallback(callback, runner);

    reporter.on("finish", function (data) {
      runner.fullResult(data);

      done(null);
    });

    reporter.on("test", function (data) {
      runner.testResult(data);
    });

    // Handle connection reset errors (raised since node 0.10)
    var middlewares = [function (err, req, res, next) {
      if (err && err.code === "ECONNRESET") {
        // Ignore this error
        next()
      } else {
        // Propagate it
        next(err);
      }
    }];

    if (runner.output.coverage) {
      middlewares.push(function (req, res, next) {
        // Provide a method to post coverage reports
        if (req.url === "/testem-please-store-coverage") {
          var family = req.headers['user-agent'] ? ua_parser.parse(req.headers['user-agent']).ua.family : "Unknown";
          var filePath = path.join(runner.output.coverage, "coverage_" + family + "_" + (+new Date()) + ".json");
          fs.writeFileSync(filePath, JSON.stringify(req.body));
          req.send(200, "OK");
        } else {
          next();
        }
      }, function (req, res, next) {
        // Modify testem.js to include additional coverage instructions
        if (req.url === "/testem.js") {
          res.setHeader('Content-Type', 'text/javascript')

          res.write(';(function(){')
          var files = [
            'socket.io.js'
            , 'json2.js'
            , 'jasmine_adapter.js'
            , 'jasmine2_adapter.js'
            , 'qunit_adapter.js'
            , 'mocha_adapter.js'
            , 'buster_adapter.js'
            , 'testem_client.js'
            // Add stuff for coverage
            , '../../../../public/testem/istanbul_coverage.js'
          ]
          async.forEachSeries(files, function(file, done){
            file = __dirname + '/../node_modules/testem/public/testem/' + file
            fs.readFile(file, function(err, data){
              if (err){
                res.write('// Error reading ' + file + ': ' + err)
              }else{
                res.write('\n//============== ' + path.basename(file) + ' ==================\n\n')
                res.write(data)
              }
              done()
            })
          }, function(){
            res.write('}());')
            res.end()
          })
        } else {
          next()
        }
      })
    }

    testem.startCI({
      file: configFile,
      reporter: reporter,
      middlewares: middlewares
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
