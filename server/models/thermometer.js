const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ThermSchema = new Schema({
    ts: { type: Date },
    val: { type: Number }
});

const Thermo = mongoose.model('Thermo', ThermSchema);
module.exports = Thermo;