var async = require('async');
var fs = require('fs');
var path = require('path');
var ua_parser = require('ua-parser');

exports.testem = function (req, res, next) {
	// Modify testem.js to include additional coverage instructions
	if (req.url === "/testem.js") {
		res.setHeader('Content-Type', 'text/javascript');

		res.write(';(function(){');
		var files = [
			'socket.io.js',
			'json2.js',
			'jasmine_adapter.js',
			'jasmine2_adapter.js',
			'qunit_adapter.js',
			'mocha_adapter.js',
			'buster_adapter.js',
			'testem_client.js',
			// Add stuff for coverage
			'../../../../public/testem/istanbul_coverage.js'
		];
		async.forEachSeries(files, function(file, done){
			file = __dirname + '/../node_modules/testem/public/testem/' + file;
			fs.readFile(file, function(err, data){
				if (err){
					res.write('// Error reading ' + file + ': ' + err);
				}else{
					res.write('\n//========= ' + path.basename(file) + ' ==============\n\n');
					res.write(data);
				}
				done();
			});
		}, function(){
			res.write('}());');
			res.end();
		});
	} else {
		next();
	}
};

// This must be bound to the test runner
exports.store = function (req, res, next) {
	// Provide a method to post coverage reports
	if (req.url === "/testem-please-store-coverage") {
		var family = req.headers['user-agent'] ? ua_parser.parse(req.headers['user-agent']).ua.family : "Unknown";
		var filePath = path.join(this.output.coverage, "coverage_" + family + "_" + (+new Date()) + ".json");
		fs.writeFileSync(filePath, JSON.stringify(req.body));
		req.send(200, "OK");
	} else {
		next();
	}
};
