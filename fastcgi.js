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

require('defaultable').def(module,
  { 'log': console
  }, function(module, exports, DEFS) {

var net = require('net')
var FCGI = require('fastcgi-parser')

var LOG = DEFS.log

module.exports = { 'handler': handler
                 }


// Connect to a FastCGI service and return an HTTP handler to forward requests to it.
function handler(socket_path, callback) {
  connect_fcgi(socket_path, 0, function(er, socket) {
    if(er)
      return callback(er)

    return callback(null, make_handler(socket))
  })
}

function make_handler(socket) {
  var fcgid = new fastcgi_stream.FastCGIStream(socket)

  fcgid.on('record', on_record)

  var request_id = 0
  return on_request

  function on_request(req, res) {
    request_id += 1

    var record = new records.BeginRequest( records.BeginRequest.roles.RESPONDER
                                         ,  records.BeginRequest.flags.KEEP_CONN
                                         )

    var result = fcgid.writeRecord(request_id, record) || null

    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end(JSON.stringify(result) + '\n');
  }

  function on_record(reqID, record) {
    LOG.info('Got record %d: %j', reqID, record)

    if(reqID == constants.NULL_REQUEST_ID)
      return LOG.info('Management record')
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
