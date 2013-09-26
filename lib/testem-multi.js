/**
* testem-multi
*
* @author sideroad
*/
(function(){
  "use strict";

  var testemAPI = require('testem'),
      async = require('async'),
      _ = require('underscore'),
      fs = require('fs'),
      BaseReporter = require('./reporter'),
      handlers,
      result;

  exports.exec = function(config){
    var json = process.argv[2] || 'testem-multi.json',
        files,
        output,
        that = this;

    this.init();
    config = config || JSON.parse( fs.readFileSync(json, 'utf-8').replace(/\n/,'')),
    files = config.files || [''];
    output = _.extend( {}, {pass : true, fail : true}, config.output );

    delete config.files;
    async.reduce(
      files,
      {
        test: [],
        ok: [],
        pass : 0,
        fail : 0,
        not : [],
        tests : 0,
        version : ""
      },
      function(memo, path, callback){
        var options = {},
            testemPath = 'testem.'+(new Date().getTime())+'.'+Math.random()+'.json',
            testem,
            results = [];
        if( path ) {
          if(/\.json$/.test(path)) {
            options = _.extend(config, JSON.parse(fs.readFileSync(path, 'utf-8').replace(/\n/,'')));
          } else {
            options = _.extend(config, {test_page: path + "#testem"});
          }
        }
        fs.writeFileSync(testemPath, JSON.stringify(options));
        that.emit('data', '# Executing '+path);
        startTestem.call(that, memo, testemPath, callback);
      },
      function(err, memo){
        var tests = memo.tests,
          pass = memo.pass,
          ok = memo.ok,
          fail = memo.fail,
          not = memo.not,
          test = memo.test;

        result = [];
        if(!output.pass && output.fail){
          result.push(not.join('\n'));
        } else if(output.pass && !output.fail) {
          result.push(ok.join('\n'));
        } else if(output.pass && output.fail){
          result.push(test.join('\n'));
        }
        result.push('');
        result.push('1..'+ tests);
        result.push('# tests '+ tests );
        result.push('# pass '+ pass );
        result.push('# fail '+ fail );
      }
    );

  };

  exports.init = function(){
    handlers = {
      data : [],
      exit: []
    };
  };
  exports.on = function( type, callback ){
    handlers[type].push(callback);
  };
  exports.emit = function(){
    var args = Array.prototype.slice.apply( arguments ),
        type = args.shift(),
        callbacks = handlers[type],
        len = callbacks.length,
        i;

    for(i=0; i<len; i++){
      callbacks[i].apply( this, args );
    }
  };

  function startTestem (memo, configFile, callback) {
    var testem = new testemAPI();
    var reporter = new BaseReporter();
    var that = this;

    reporter.on("finish", function (data) {
      memo.test = memo.test.concat(data.test);
      memo.ok = memo.ok.concat(data.ok);
      memo.not = memo.not.concat(data.not);
      memo.pass += data.pass;
      memo.fail += data.fail;
      memo.tests += data.tests;

      callback(null, memo);
    });

    testem.startCI({
      file: configFile,
      reporter: reporter
    }, function () {
      fs.unlinkSync( configFile );
      if (result) {
        that.emit('exit', result.join('\n'), memo);
      }
    });
  }

})();
