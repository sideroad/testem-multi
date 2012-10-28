/**
* testem-multi
*
* @author sideroad
*/
(function(){
  "use strict";

  var exec = require('child_process').exec,
      async = require('async'),
      _ = require('underscore'),
      fs = require('fs');

  exports.exec = function(){
    var json = process.argv[2] || 'testem-multi.json',
        config = JSON.parse( fs.readFileSync(json, 'utf-8').replace(/\n/,'')),
        files = config.files || [],
        browsers = config.browsers||[],
        ci = (browsers.length) ? ' -l ' + browsers.join(',') : '';

    delete config.files;
    console.log("TAP version 13");
    async.reduce(
      files,
      {
        tests : 0
      },
      function(memo, path, callback){
        config.test_page = path;
        fs.writeFileSync('testem.json', JSON.stringify(config));
        exec('testem ci'+ci, {}, function( code, stdout, stderr ){
          var result = _.chain(stdout.split('\n')),
            tests = memo.tests,
            test = result.map(function( item ){
              var reg = /^(ok|not ok) (\d+) - ([^\n]+)/,
                  match = item.match(reg);
              return (reg.test(item)) ? match[1]+" "+(Number( match[2] )+tests)+" - "+path+" - "+match[3] : false;
            }).compact().value();

          console.log(test.join('\n'));
          memo.tests += test.length;

          callback(null, memo);
        });
      },
      function(err, memo){
        fs.unlinkSync('testem.json');
        console.log("1.."+memo.tests);
      }
    );

  };

})();
