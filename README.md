[![build status](https://secure.travis-ci.org/iriscouch/fastcgi.png)](http://travis-ci.org/iriscouch/fastcgi)
# FastCGI for Node.js

**fastcgi** is an extremely simple web server that serves a FastCGI application.

Install it (globally) with npm:

    $ npm install -g fastcgi

Suppose you have a FastCGI application (e.g. Django) listening on Unix socket `/opt/myapp/socket`, you don't want to set up Apache httpd, nginx, or anything else:

    $ fastcgi --port=8888 --socket=/opt/myapp/socket

*Voila!* Instant web application. Basically, `fastcgi` exports a FastCGI/unix service to be an HTTP/inet service.

## Usage

`fastcgi` is an [npm][npm] package and command-line tool 

    $ ./cli.js --help
    Usage: node ./cli.js [options] <FastCGI program> [program arg1] [arg2] [...]

    Options:
      --die     Exit after serving one request                     [boolean]
      --log     Path to log file
      --port    Listening port number                              [required]
      --max     Maximum allowed subprocesses                       [default: 25]
      --daemon  Daemonize (run in the background); requires --log  [boolean]
      --lock    Lockfile to use when daemonizing
      --socket  Unix socket FastCGI program will use               [required]

The `--daemon` flag is helpful. It will make `fastcgi` run in the background.

[npm]: http://npmjs.org

## License

Apache 2.0

[kanso]: http://kan.so
