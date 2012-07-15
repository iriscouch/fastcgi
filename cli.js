#!/usr/bin/env node
//
// FastCGI web server

var util = require('util')
var optimist = require('optimist')

var fastcgi = require('./fastcgi')

var ARGV = null, OPTS = null
if(require.main === module)
  main(get_argv())

function main() {
  if(!ARGV._[0])
    return usage()
  if(ARGV.help)
    return usage()

  console.log('Done.')
}

//
// Utilities
//

function get_argv() {
  OPTS = optimist.boolean(['die'])
                 .demand(['port'])
                 .default({ 'max': 25
                         })
                 .describe({ 'die': 'Exit after serving one request'
                           , 'port': 'Listening port number'
                           , 'max': 'Maximum allowed subprocesses'
                          })
                 .usage('Usage: $0 [options] <FastCGI program>')

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
