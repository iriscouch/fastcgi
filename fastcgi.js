// FastCGI
//
// Copyright 2011 Iris Couch
//
//    Licensed under the Apache License, Version 2.0 (the "License");
//    you may not use this file except in compliance with the License.
//    You may obtain a copy of the License at
//
//        http://www.apache.org/licenses/LICENSE-2.0
//
//    Unless required by applicable law or agreed to in writing, software
//    distributed under the License is distributed on an "AS IS" BASIS,
//    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//    See the License for the specific language governing permissions and
//    limitations under the License.

// Specification: http://www.fastcgi.com/drupal/node/22

require('defaultable').def(module,
  { 'log': console
  }, function(module, exports, DEFS) {

var net = require('net')
var URL = require('url')
var util = require('util')
var http = require('http')
var FCGI = require('fastcgi-parser')

var LOG = DEFS.log

module.exports = { 'httpd': httpd
                 }


// Connect to a FastCGI service and run an HTTP front-end sending all requests to it.
function httpd(port, host, socket_path, callback) {
  connect_fcgi(socket_path, 0, function(er, socket) {
    if(er)
      return callback(er)

    fcgi_get_values(socket, function(er, values) {
      if(er)
        return callback(er)

      LOG.info('FCGI values: %j', values)
      var server = http.createServer(fcgi_handler(port, host, socket, socket_path))
      server.listen(port, host)
      return callback(null)
    })
  })
}

function fcgi_get_values(socket, callback) {
  LOG.info('Get FastCGI values')
  socket.on('data', on_data)

  var values = [ ['FCGI_MAX_CONNS' , '']
               , ['FCGI_MAX_REQS'  , '']
               , ['FCGI_MPXS_CONNS', '']
               ]

  var writer = new FCGI.writer
  writer.encoding = 'binary'

  writer.writeHeader({ 'version' : FCGI.constants.version
                     , 'type'    : FCGI.constants.record.FCGI_GET_VALUES
                     , 'recordId': 0
                     , 'contentLength': FCGI.getParamLength(values)
                     , 'paddingLength': 0
                     })
  writer.writeParams(values)
  socket.write(writer.tobuffer())

  writer.writeHeader({ 'version' : FCGI.constants.version
                     , 'type'    : FCGI.constants.record.FCGI_GET_VALUES
                     , 'recordId': 0
                     , 'contentLength': 0
                     , 'paddingLength': 0
                     })
  socket.write(writer.tobuffer())

  LOG.info('Listening for FastCGI values')
  var fcgi_values = {}
  var timeout = setTimeout(got_all_values, 100)

  function on_data(data) {
    var parser = new FCGI.parser
    parser.encoding = 'utf8'
    parser.onRecord = on_record
    parser.onError  = on_error
    parser.execute(data)
  }

  function on_error(er) {
    LOG.error('Error getting FastCGI values: %s', er.message || er)
    parser.onRecord = parser.onError = function() {}
    callback(er)
  }

  function on_record(record) {
    var params = record.body.params || {}
      , keys = Object.keys(params)

    keys.forEach(function(key) {
      var num_value = +params[key]
      fcgi_values[key] = isNaN(num_value) ? params[key] : num_value
    })

    if(keys.length == 0)
      got_all_values()
  }

  function got_all_values() {
    clearTimeout(timeout)
    socket.removeListener('data', on_data)
    callback(null, fcgi_values)
  }
}

function fcgi_handler(port, server_addr, socket, socket_path) {
  var requests = {}
    , request_id = 0

  prep_socket()
  return on_request

  function on_request(req, res) {
    LOG.info('Request: %j', req.url)

    request_id += 1
    requests[request_id] = { 'req': req
                           , 'res':res
                           , 'stdout': []
                           , 'stderr': []
                           }

    req.url = URL.parse(req.url)
    var cgi = { 'PATH_INFO': req.url.pathname
              , 'SERVER_NAME': server_addr || 'unknown'
              , 'SERVER_PORT': port
              , 'SERVER_PROTOCOL': 'HTTP/1.1'
              , 'SERVER_SOFTWARE': 'Node/' + process.version
              }

    Object.keys(req.headers).forEach(function(header) {
      var key = 'HTTP_' + header.toUpperCase().replace(/-/g, '_')
      cgi[key] = req.headers[header]
    })

    cgi.REQUEST_METHOD = req.method
    cgi.QUERY_STRING = req.url.query || ''
    if('content-length' in req.headers)
      cgi.CONTENT_LENGTH = req.headers['content-length']
    if('content-type' in req.headers)
      cgi.CONTENT_LENGTH = req.headers['content-type']
    if('authorization' in req.headers)
      cgi.AUTH_TYPE = req.headers.authorization.split(/ /)[0]

    //LOG.info('CGI: %j', cgi)

    var params = []
    Object.keys(cgi).forEach(function(key) {
      params.push([key, cgi[key]])
    })

    // Write the request to FastCGI.
    var writer = new FCGI.writer
    writer.encoding = 'binary'

    // Begin
    writer.writeHeader({ 'version' : FCGI.constants.version
                       , 'type'    : FCGI.constants.record.FCGI_BEGIN
                       , 'recordId': request_id
                       , 'contentLength': 8
                       , 'paddingLength': 0
                       })
    writer.writeBegin({ 'role': FCGI.constants.role.FCGI_RESPONDER
                      , 'flags': FCGI.constants.keepalive.OFF
                      })
    socket.write(writer.tobuffer())

    // Parameters
    writer.writeHeader({ 'version' : FCGI.constants.version
                       , 'type'    : FCGI.constants.record.FCGI_PARAMS
                       , 'recordId': request_id
                       , 'contentLength': FCGI.getParamLength(params)
                       , 'paddingLength': 0
                       })
    writer.writeParams(params)
    socket.write(writer.tobuffer())

    // End parameters
    writer.writeHeader({ 'version' : FCGI.constants.version
                       , 'type'    : FCGI.constants.record.FCGI_PARAMS
                       , 'recordId': request_id
                       , 'contentLength': 0
                       , 'paddingLength': 0
                       })
    socket.write(writer.tobuffer())

    // STDIN
    writer.writeHeader({ 'version' : FCGI.constants.version
                       , 'type'    : FCGI.constants.record.FCGI_STDIN
                       , 'recordId': request_id
                       , 'contentLength': 0
                       , 'paddingLength': 0
                       })
    socket.write(writer.tobuffer())
  }

  function prep_socket() {
    socket.on('data', on_data)
    socket.on('end', on_end)
  }

  function on_end() {
    connect_fcgi(socket_path, 0, function(er, new_socket) {
      if(er)
        throw er // TODO

      LOG.info('Reconnected: %s', socket_path)
      socket = new_socket
      prep_socket()
    })
  }

  function on_data(data) {
    var parser = new FCGI.parser
    parser.encoding = 'utf8'
    parser.onRecord = on_record
    parser.onError  = on_error
    parser.execute(data)
  }

  function on_error(er) {
    LOG.error('Error from FastCGI parser: %s', er.message || er)
    throw er // TODO
  }

  function on_record(record) {
    var req_id = record.header.recordId
    if(req_id == 0)
      return LOG.info('Ignoring management record: %j', record)

    var request = requests[req_id]
    if(!request)
      throw new Error('Record for unknown request: ' + req_id) // TODO

    if(typeof record.body == 'object' && JSON.stringify(record.body) == '{}')
      record.body = ''

    if(record.header.type == FCGI.constants.record.FCGI_STDERR)
      return LOG.error('Error: %s', record.body.trim())

    else if(record.header.type == FCGI.constants.record.FCGI_STDOUT) {
      return send(request, record.body)
    }

    else if(record.header.type == FCGI.constants.record.FCGI_END)
      return request.res.end()

    else {
      LOG.info('Record: %j', record)
      Object.keys(FCGI.constants.record).forEach(function(type) {
        if(record.header.type == FCGI.constants.record[type])
          LOG.info('Unknown record type: %s', type)
      })
    }
  }

  function send(request, data) {
    request.stdout.push(data)
    data = request.stdout.join('')
    request.stdout = []

    if(!request.status) {
      // Still looking for the headers and status.
      var parts = data.split(/\r?\n\r?\n/)
      if(parts.length < 2)
        return // Still waiting for all headers to arrive.

      // Headers (and perhaps some body) have arrived.
      var lines = parts[0].split(/\r?\n/)
        , headers = {}

      lines.forEach(function(line) {
        var match = line.match(/^(.*?):\s(.*)$/)
          , key = match && match[1].toLowerCase()

        if(key == 'status')
          request.status = parseInt(match[2]) || 200
        else
          headers[key] = match[2]
      })

      console.log('%d %j', request.status, headers)
      request.res.writeHead(request.status, headers)
      data = parts.slice(1).join('\n')
    }

    if(data.length) {
      console.log('Write data: %j', data)
      request.res.write(data)
    }
  }
}

function connect_fcgi(socket, attempts, callback) {
  if(attempts > 5)
    return callback(new Error('Failed to connect to back-end socket'))

  // Try to connect to the back-end socket.
  var fcgid = net.connect({'path':socket})

  fcgid.on('error', on_error)
  fcgid.on('connect', on_connect)

  function on_connect() {
    LOG.info('Connected to FastCGI daemon: %s', socket)
    fcgid.removeListener('error', on_error)
    return callback(null, fcgid)
  }

  function on_error(er) {
    if(er.code != 'ECONNREFUSED') {
      LOG.error('Unknown error on FastCGI connection: %s', er.message)
      return callback(er)
    }

    var delay = 100 * Math.pow(2, attempts)
    LOG.info('Waiting %d ms to connect', delay)
    return setTimeout(function() { connect_fcgi(socket, attempts+1, callback) }, delay)
  }
}


}) // defaultable
