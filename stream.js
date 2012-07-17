// FCGI stream
//
// Copyright 2012 Iris Couch
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

// Chop a data stream (of buffers) on FastCGI record boundaries.

var util = require('util')
var stream = require('stream')

module.exports = FastCGIStream


util.inherits(FastCGIStream, stream)
function FastCGIStream (opts) {
  var self = this
  stream.call(self)

  opts = opts || {}
  self.log = opts.log || console

  self.readable = true
  self.writable = true
  self.is_ending = false
  self.is_sending = true
  self.pending_data = []
  self.records = []

  self.source = null
  self.once('pipe', function(src) {
    self.source = src
    self.on('pipe', function(src) {
      var er = new Error('Already have a pipe source')
      er.source = self.source
      self.error(er)
    })
  })
}


//
// Readable stream API
//

FastCGIStream.prototype.setEncoding = function(encoding) {
  var self = this
  throw new Error('setEncoding not allowed, only Buffer is supported') // TODO: Maybe "hex" encoding?
}


FastCGIStream.prototype.pause = function() {
  var self = this
  self.is_sending = false

  if(self.source && self.source.pause)
    self.source.pause()
}


FastCGIStream.prototype.resume = function() {
  var self = this
  self.is_sending = true
  if(self.source && self.source.resume)
    self.source.resume()
  self.emit_records()
}

//
// Writable stream API
//

FastCGIStream.prototype.write = function(data, encoding) {
  var self = this

  self.log.log('write: %s', data ? data.length : 'null')
  if(data)
    self.pending_data.push(data)
  self.build_record()

  return !self.is_ending
}


FastCGIStream.prototype.build_record = function() {
  var self = this
  //self.log.log('== Build record')

  // The first buffer must at least be a complete header, or nothing can be done.
  while(self.pending_data.length > 1 && self.pending_data[0].length < 8) {
    //self.log.log('Joining next two chunks to find a header')
    var first_chunk = self.pending_data.shift()
      , second_chunk = self.pending_data.shift()
    self.pending_data.unshift(Buffer.concat([first_chunk, second_chunk]))
  }

  var pending_bytes = self.pending_data.reduce(function(len, buf) { return len + buf.length }, 0)
  //self.log.log('Unprocessed bytes in %d buffers: %d', self.pending_data.length, pending_bytes)

  if(pending_bytes < 8)
    return self.emit_records() // No more data to process; emit any completed records.

  var header = get_header(self.pending_data[0])
  //self.log.log('Next header: %j', header)

  var record_bytes = 8 + header.body_len + header.pad_len // The header itself + content + padding
  if(pending_bytes < record_bytes) {
    //self.log.log('Received %d/%d bytes for the record; need %d', pending_bytes, record_bytes, record_bytes - pending_bytes)
    return self.emit_records()
  }

  // At this point, an entire record's worth of data is in the pending queue.
  var record = new Buffer(record_bytes)
    , offset = 0

  //self.log.log('Building record:')
  while(offset < record_bytes) {
    var bytes_needed = record_bytes - offset
    var next_chunk = self.pending_data.shift()

    //self.log.log('  At %d/%d, need %d, chunk is %d', offset, record_bytes, bytes_needed, next_chunk.length)
    if(next_chunk.length <= bytes_needed) {
      // This chunk entirely belongs in the record.
      next_chunk.copy(record, offset, 0, next_chunk.length)
      offset += next_chunk.length
    } else {
      // This chunk completes the record and has data left over.
      //self.log.log('    Copy %d-%d from chunk which is %d', offset, bytes_needed, next_chunk.length)
      next_chunk.copy(record, offset, 0, bytes_needed)
      offset += bytes_needed
      var partial_chunk = next_chunk.slice(bytes_needed)
      //self.log.log('  %d bytes remain after the record, keeping %d', next_chunk.length - bytes_needed, partial_chunk.length)
      self.pending_data.unshift(partial_chunk)
    }
  }

  //self.log.log('Built record of size: %d', record.length)
  self.records.push(record)

  // Run again, to perhaps build up another record (and ultimately emit them).
  self.build_record()
}


FastCGIStream.prototype.end = function(data, encoding) {
  var self = this

  self.is_ending = true
  self.writable = false

  // Always call write, even with no data, so it can fire the "end" event.
  self.write(data, encoding)

  if(self.pending_data.length) {
    self.log.warn('Unprocessed data after "end" called:')
    if(self.pending_data[0].length >= 8)
      self.log.warn('  %j', get_header(self.pending_data[0]))
    self.pending_data.forEach(function(data) {
      self.log.warn('  %s', util.inspect(data))
    })
  }
}


FastCGIStream.prototype.emit_records = function() {
  var self = this

  while(self.is_sending && self.records.length > 0) {
    var record = self.records.shift()
    //self.log.log('emit record: %d bytes', record.length)
    self.emit('data', record)
  }

  // React to possible end-of-data from the source stream.
  if(self.is_sending && self.is_ending && self.records.length === 0) {
    self.is_ending = false
    self.readable = false
    //self.log.log('emit: end')
    self.emit('end')
  }
}

//
// Readable/writable stream API
//

FastCGIStream.prototype.destroy = function() {
  var self = this
  //self.log.log('destroy')

  self.is_dead = true
  self.is_ending = false
  self.is_sending = false

  if(self.source && typeof self.source.destroy === 'function')
    self.source.destroy()
}


FastCGIStream.prototype.destroySoon = function() {
  var self = this
  throw new Error('not implemented')
  //return self.request.destroySoon()
}

//
// Internal implementation
//

FastCGIStream.prototype.normalize_data = function(data, encoding) {
  var self = this

  if(data instanceof Buffer)
    data = data.toString(encoding)
  else if(typeof data === 'undefined' && typeof encoding === 'undefined')
    data = ""

  if(typeof data != 'string')
    return self.error(new Error('Not a string or Buffer: ' + util.inspect(data)))

  if(self.feed !== 'continuous' && self.feed !== 'longpoll')
    return self.error(new Error('Must set .feed to "continuous" or "longpoll" before writing data'))

  if(self.expect === null)
    self.expect = (self.feed == 'longpoll')
                    ? DEFS.longpoll_header
                    : ""

  var prefix = data.substr(0, self.expect.length)
  data = data.substr(prefix.length)

  var expected_part = self.expect.substr(0, prefix.length)
    , expected_remainder = self.expect.substr(expected_part.length)

  if(prefix !== expected_part)
    return self.error(new Error('Prefix not expected '+util.inspect(expected_part)+': ' + util.inspect(prefix)))

  self.expect = expected_remainder
  return data
}


FastCGIStream.prototype.error = function(er) {
  var self = this

  self.readable = false
  self.writable = false
  self.emit('error', er)

  // The write() method sometimes returns this value, so if there was an error, make write() return false.
  return false
}

//
// Utilities
//

function get_header(chunk) {
  return { 'version' : chunk.readUInt8(0)
         , 'type'    : chunk.readUInt8(1)
         , 'req_id'  : chunk.readUInt16BE(2)
         , 'body_len': chunk.readUInt16BE(4)
         , 'pad_len' : chunk.readUInt8(6)
         , 'reserved': chunk.readUInt8(7)
         }
}
