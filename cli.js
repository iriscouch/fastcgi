#!/usr/bin/env node
//
// FastCGI web server

var fs = require('fs')
var util = require('util')
var path = require('path')
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

  if(ARGV.daemon && !ARGV.log)
    return usage('log')
  if(ARGV.daemon && !ARGV.pidfile)
    return usage('pidfile')

  if(ARGV.daemon)
    return daemonize()
  else if(ARGV.parent)
    childize(init)
  else
    init()
}

function init(er) {
  if(er)
    throw er

  process.on('SIGINT', die)
  process.on('SIGTERM', die)

  var command = ARGV._[0]
    , args    = ARGV._.slice(1)
    , options = {}

  if(!command)
    return begin_http()

  var http_timer = setTimeout(begin_http, 250)

  LOG.log('Run: %j %j', command, args)
  var child = child_process.spawn(command, args, options)

  child.stderr.setEncoding('utf8')
  child.stdout.setEncoding('utf8')

  child.stdout.on('data', function(data) {
    data.split(/\n/).forEach(function(line) {
      LOG.log('STDOUT: %s', line)
    })
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
    LOG.log('Exit %d: %s %j', code, command, args)
  })

  function die() {
    LOG.log('Exit')
    if(child) {
      LOG.info('Kill child at %d', child.pid)
      child.kill('SIGTERM')
    }

    if(ARGV.parent)
      undaemonize(finished)
    else
      finished()

    function finished(er) {
      if(er)
        throw er
      process.exit(0)
    }
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

function daemonize() {
  LOG.info('Daemonize, log at %s; pid at %s', ARGV.log, ARGV.pidfile)

  // Do a poor-man's exclusive open of the PID file, while the console is still conveniently available.
  var pidfile = fs.createReadStream(ARGV.pidfile, {'encoding':'utf8'})

  pidfile.on('open', function(fd) {
    // Daemonization cannot continue with a PID file in place.
    var data = ''
    pidfile.on('end', done)
    pidfile.on('error', function(er) { throw er })
    pidfile.on('data', function(chunk) {
      data += chunk
      if(data.length > 10)
        done()
    })

    function done() {
      if(data == '') {
        LOG.warn('Overwrite empty PID file: %s', ARGV.pidfile)
        return prep_spawn()
      }
      var pid = +data
      if(typeof pid != 'number' || isNaN(pid))
        pid = '[unknown]'

      LOG.error('Daemon already running at pid %s', pid)
      process.exit(1)
    }
  })

  pidfile.on('error', function(er) {
    if(er.code != 'ENOENT')
      throw er
    else
      prep_spawn()
  })

  function prep_spawn() {
    // Good. Open the log file and spawn the child. (The child will try an exclusive open too of course.)
    // Also, it seems as if the child needs two distinct file descriptors. Not sure if that is a bug.
    var log = fs.createWriteStream(ARGV.log, {'flags':'a', 'mode':0600})
    log.on('error', function(er) { throw er })

    log.on('open', function(out_fd) {
      var err = fs.createWriteStream(ARGV.log, {'flags':'a', 'mode':0600})
      err.on('error', function(er) { throw er })

      err.on('open', function(err_fd) {
        log.write(util.format('%d: Spawn daemon\n', process.pid))
        spawn(out_fd, err_fd)
      })
    })
  }
}

function spawn(new_stdout, new_stderr) {
  var command = process.argv[0]
    , opts = {'cwd':'/', 'detached':true, 'stdio':['ignore', new_stdout, new_stderr||new_stdout]}

  var args = process.argv.slice(1)
    .map(function(arg) {
      if(arg.match(/^--daemon/))
        return '--parent=' + process.pid
      var match = arg.match(/^--(\w+)=(.*)$/)
        , key = match && match[1]
        , val = match && match[2]
      if(key == 'log')
        return null
      if(key == 'socket' || key == 'pidfile')
        return '--' + key + '=' + path.resolve(val)
      return arg
    })
    .filter(function(arg) { return !! arg })

  //LOG.log('Parent: %d\ncommand: %j\nargs: %j\nopts: %j', process.pid, command, args, opts)

  var child = child_process.spawn(command, args, opts)
  child.unref()
}

function childize(callback) {
  // Initialize the daemon child.
  var pidfile = fs.createWriteStream(ARGV.pidfile, {'flags':'w', 'mode':0640, 'encoding':'utf8'})
  pidfile.on('error', function(er) {
    callback(er)
  })

  pidfile.on('open', function(fd) {
    pidfile.write(process.pid + '\n')
    pidfile.end()

    LOG.info('%d: daemon running', process.pid)
    callback()
  })
}

function undaemonize(callback) {
  fs.unlink(ARGV.pidfile, function(er) {
    if(er)
      LOG.error('Failed to clean PID file %j: %s', ARGV.pidfile, er.message)
    else
      LOG.log('Cleaned pid file: %s', ARGV.pidfile)

    return callback(er)
  })
}

//
// Utilities
//

function get_argv() {
  OPTS = optimist.boolean(['die', 'daemon'])
                 .demand(['port', 'socket'])
                 .default({ 'max': 25
                         })
                 .describe({ 'die': 'Exit after serving one request'
                           , 'log': 'Path to log file'
                           , 'port': 'Listening port number'
                           , 'max': 'Maximum allowed subprocesses'
                           , 'daemon': 'Daemonize (run in the background); requires --log and --pidfile'
                           , 'pidfile': 'Lockfile to use when daemonizing'
                           , 'socket': 'Unix socket FastCGI program will use'
                          })
                 .usage('Usage: $0 [options] <FastCGI program> [program arg1] [arg2] [...]')

  ARGV = OPTS.argv
}

function usage(code) {
  if(typeof code == 'string') {
    var needed = code
    code = 1
  } else
    code = code || 0

  OPTS.showHelp(function(lines) {
    lines.split(/\n/).forEach(function(line) {
      code > 0
        ? LOG.error(line)
        : LOG.log(line)
    })
  })

  if(needed)
    LOG.error('Missing required argument: %s', needed)

  process.exit(code)
}
