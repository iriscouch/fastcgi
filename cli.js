#!/usr/bin/env node
//
// FastCGI web server

var util = require('util')
var http = require('http')
var optimist = require('optimist')
var child_process = require('child_process')

var fastcgi = require('./fastcgi')

var ARGV = null, OPTS = null
if(require.main === module)
  main(get_argv())

function main() {
  if(!ARGV._[0])
    return usage()
  if(ARGV.help)
    return usage()

  var command = ARGV._[0]
    , args    = ARGV._.slice(1)
    , options = {}

  console.log('Run: %j %j', command, args)
  var child = child_process.spawn(command, args, options)

  child.stdout.on('data', function(data) {
    console.log('STDOUT: %j', data)
  })

  child.stderr.on('data', function(data) {
    if (/^execvp\(\)/.test(data))
      return console.error('Failed to start child process')

    console.log('STDERR: %j', data)
  })

  child.on('exit', function(code) {
    console.log('Exit %j: %d', command, code)
  })

  // Now run the HTTP front-end.
  httpd()
}

function httpd() {
  var host = '0.0.0.0'
    , port = ARGV.port
    , fcgi_service = ARGV.socket

  var server = http.createServer(on_req)
  server.listen(port, host)
  console.log('HTTP on %s:%d', host, port)

  function on_req(req, res) {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('Hello World\n');
  }
}

//
// Utilities
//

function get_argv() {
  OPTS = optimist.boolean(['die'])
                 .demand(['port', 'socket'])
                 .default({ 'max': 25
                         })
                 .describe({ 'die': 'Exit after serving one request'
                           , 'port': 'Listening port number'
                           , 'max': 'Maximum allowed subprocesses'
                           , 'socket': 'Unix socket FastCGI program will use'
                          })
                 .usage('Usage: $0 [options] <FastCGI program> [program arg1] [arg2] [...]')

  ARGV = OPTS.argv
}

function usage(code) {
  code = code || 0
  OPTS.showHelp(function(lines) {
    lines.split(/\n/).forEach(function(line) {
      code > 0
        ? console.error(line)
        : console.log(line)
    })
  })

  process.exit(code)
}
