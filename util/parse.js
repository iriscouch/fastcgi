#!/usr/bin/env node
//
// Parse a given file.

var fs = require('fs')
var FCGI = require('fastcgi-parser')
var util = require('util')

var path = process.argv[3] || process.argv[2]
body = fs.readFileSync(path)
show_buf(body)
console.log('')

var parser = new FCGI.parser
parser.bodies = []
parser.encoding = 'binary'
parser.onBody   = on_body
parser.onRecord = on_record
parser.onError  = function(er) { console.log('Parser error'); throw er }
parser.execute(body)

function on_body(data, start, end) {
  data = data.slice(start, end)
  console.log('Body (%d): %s', data.length, util.inspect(data))
  parser.bodies.push(data)
}

function on_record(record) {
  console.log('Record: %j', record)
}

function show_buf(buf) {
  var width = 30

  for(var i = 0; i < buf.length; i += width) {
    var line = []
    for(var j = i; j - i < width; j++)
      //line.push(buf[i*width + j])
      line.push(buf[j])

    line = line.map(format_num).join(' ')
    console.log('%s: %s', format_num(i), line)
  }
}

function format_num(num) {
  if(num < 10)
    return '  ' + num
  else if(num < 100)
    return ' ' + num
  else if(num === undefined)
    return ''
  else
    return '' + num
}
