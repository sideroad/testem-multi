var util = require("util");
var events = require("events");

function BaseReporter() {
  events.EventEmitter.call(this);

  // Total number of tests
  this.total = 0;
  // Number of success tests
  this.pass = 0;
  // Number of test failures
  this.fail = 0;
  // Whole list of tests
  this.test = [];
  // List of failing tests
  this.not = [];
  // List of passing tests
  this.ok = [];
}

util.inherits(BaseReporter, events.EventEmitter);

BaseReporter.prototype.report = function(prefix, data) {
  var test = (prefix ? (prefix + ' - ') : '') + data.name.trim();
  this.total += 1;
  if (data.passed) {
    this.pass += 1;
    this.ok.push(test);
  } else {
    this.fail += 1;
    this.not.push(test);
  }
  if (data.error) {
    var inside = Object.keys(data.error)
      .filter(function(key) {
        return key !== 'passed'
      })
      .map(function(key) {
        return key + ': >\n' + indent("" + data.error[key])
      });
    test += "\n" + indent(inside.join('\n'), "#");
  }
  this.test.push(test);
  this.emit("test", {
    ok: data.passed,
    name: test
  });
};

BaseReporter.prototype.finish = function() {
  this.emit("finish", {
    tests: this.total,
    pass: this.pass,
    fail: this.fail,
    test: this.test,
    not: this.not,
    ok: this.ok
  });
};

function indent(text, prefix) {
  prefix = prefix || "";
  return text.split("\n").map(function(line) {
    return prefix + "    " + line;
  }).join("\n");
}

module.exports = BaseReporter;
