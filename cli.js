#!/usr/bin/env node
//
// FastCGI web server

var util = require('util')
var optimist = require('optimist')
var child_process = require('child_process')

var fastcgi = require('./fastcgi')

var LOG = console
var ARGV = null, OPTS = null
if(require.main === module)
  main(get_argv())

function main() {
  if(ARGV.help)
    return usage()

  var command = ARGV._[0]
    , args    = ARGV._.slice(1)
    , options = {}

  if(!command)
    begin_http()
  else {
    var http_timer = setTimeout(begin_http, 250)

    LOG.log('Run: %j %j', command, args)
    var child = child_process.spawn(command, args, options)

    child.stderr.setEncoding('utf8')
    child.stdout.setEncoding('utf8')

    child.stdout.on('data', function(data) {
      LOG.log('STDOUT: %j', data)
    })

    child.stderr.on('data', function(data) {
      if (/^execvp\(\)/.test(data))
        return LOG.error('Failed to start child process')

      data.split(/\n/).forEach(function(line) {
        LOG.log('STDERR: %s', line)
      })
    })

    child.on('exit', function(code) {
      clearTimeout(http_timer)
      LOG.log('Exit %j: %d', command, code)
    })
  }

  function begin_http() {
    LOG.log('Sending http requests to %s', ARGV.socket)
    fastcgi.httpd(ARGV.port, '0.0.0.0', ARGV.socket, function(er) {
      if(er)
        throw er

      LOG.log('Listening on 0.0.0.0:%d', ARGV.port)
    })
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
        ? LOG.error(line)
        : LOG.log(line)
    })
  })

  process.exit(code)
}
