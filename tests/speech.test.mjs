import test from 'node:test'
import assert from 'node:assert/strict'
import {SPEAK_MAX, speakable} from '../lib/speech/clean.js'
import {lineOf, SELF_TYPE, SCAN_MS} from '../lib/speech/mouth.js'
import {
  SPEECH_DEFAULTS, SPEECH_MODES, VOICE_OPTIONS_KIND, PRESET_OPTIONS_KIND, MODE_OPTIONS_KIND, DEVICE_OPTIONS_KIND,
  speechMode, resolveSpeak, voiceOptionRows, presetOptionRows, modeOptionRows, deviceOptionRows, setDeviceRows,
  configOptions, speechConfigGroups
} from '../lib/speech/settings.js'
import {pickDevice} from '../lib/speech/audio/native.js'
import {DEFAULT_VOICE, CUSTOM_PRESET, VOICE_OPTIONS, VOICE_PRESETS, RATE_OPTIONS, PITCH_OPTIONS, VOLUME_OPTIONS} from '../lib/speech/voices.js'

test('语音默认值与音色表可用', () => {
  assert.equal(SPEECH_DEFAULTS.voice, DEFAULT_VOICE)
  assert.equal(SPEECH_DEFAULTS.preset, CUSTOM_PRESET)
  assert.ok(VOICE_OPTIONS.length >= 10)
  assert.ok(VOICE_PRESETS.length >= 8)
  assert.ok(RATE_OPTIONS.includes('+0%') && PITCH_OPTIONS.includes('+0Hz') && VOLUME_OPTIONS.includes('+0%'))
  for (const row of voiceOptionRows()) assert.ok(row.value && row.label)
})

test('可朗读文本会去掉标记、链接并截断', () => {
  const cleaned = speakable('**收到啦** [链接](http://x.y) 😀')
  assert.ok(cleaned.includes('收到啦'), cleaned)
  assert.ok(!cleaned.includes('http'), cleaned)
  assert.ok(!cleaned.includes('*') && !cleaned.includes('😀'), cleaned)
  assert.equal(speakable(null), '')
  const long = '啊'.repeat(SPEAK_MAX + 200)
  const cut = speakable(long)
  assert.ok(cut.length <= SPEAK_MAX + 2, `截断后 ${cut.length} 字`)
  assert.ok(cut.endsWith('……'))
})

test('resolveSpeak 让语音包覆盖单项，未知值回退默认', () => {
  const warm = VOICE_PRESETS.find(p => p.id === 'warm')
  assert.deepEqual(resolveSpeak({preset: 'warm'}), {voice: warm.voice, rate: warm.rate, volume: warm.volume, pitch: warm.pitch, device: ''})
  const custom = resolveSpeak({preset: CUSTOM_PRESET, voice: 'en-US-AriaNeural', rate: '+15%', pitch: '-10Hz', volume: '+20%', outputDevice: 'CABLE Input'})
  assert.deepEqual(custom, {voice: 'en-US-AriaNeural', rate: '+15%', pitch: '-10Hz', volume: '+20%', device: 'CABLE Input'})
  const fallback = {voice: DEFAULT_VOICE, rate: '+0%', pitch: '+0Hz', volume: '+0%', device: ''}
  assert.deepEqual(resolveSpeak({preset: CUSTOM_PRESET, voice: 'nope', rate: 'nope', pitch: 'nope', volume: 'nope'}), fallback)
  assert.deepEqual(resolveSpeak({}), fallback)
})

test('播放设备按名称或序号解析，认不出就回默认设备', () => {
  const devices = [{index: 0, name: '扬声器 (Realtek)'}, {index: 1, name: 'LegionZone 虚拟扬声器'}, {index: 2, name: 'CABLE Input'}]
  assert.equal(pickDevice(devices, ''), '')
  assert.equal(pickDevice(devices, '1'), 'LegionZone 虚拟扬声器', '序号按 index 匹配')
  assert.equal(pickDevice(devices, 'cable input'), 'CABLE Input', '不区分大小写')
  assert.equal(pickDevice(devices, 'legionzone'), 'LegionZone 虚拟扬声器', '名称片段也能命中')
  assert.equal(pickDevice(devices, '不存在的设备'), '', '认不出回默认')
  assert.equal(pickDevice([], 'CABLE Input'), '')
  assert.equal(pickDevice(devices, 9), '', '没有这个序号')
})

test('speechMode 只接受三档，其余回退 auto', () => {
  assert.deepEqual(SPEECH_MODES, ['auto', 'on', 'off'])
  assert.equal(speechMode({selfSpeak: 'on'}), 'on')
  assert.equal(speechMode({selfSpeak: 'off'}), 'off')
  assert.equal(speechMode({selfSpeak: '乱写'}), 'auto')
  assert.equal(speechMode({}), 'auto')
})

test('选项表按 kind 提供，未知 kind 返回空', () => {
  assert.ok(voiceOptionRows().length === configOptions(VOICE_OPTIONS_KIND).length)
  assert.equal(configOptions(PRESET_OPTIONS_KIND)[0].value, CUSTOM_PRESET, '自定义语音包排第一')
  assert.deepEqual(configOptions(MODE_OPTIONS_KIND), modeOptionRows())
  assert.deepEqual(configOptions('livecom.unknown'), [])
  assert.equal(presetOptionRows().length, VOICE_PRESETS.length + 1)
  const ids = presetOptionRows().map(r => r.value)
  for (const preset of VOICE_PRESETS) assert.ok(ids.includes(preset.id), `缺少语音包 ${preset.id}`)
})

test('设置分组默认值真的写进配置路径，且改动立即生效', () => {
  const [group] = speechConfigGroups('live-comments')
  assert.equal(group.id, 'world:live-comments.voice')
  assert.equal(group.owner, 'world:live-comments')
  assert.equal(group.schema.type, 'object')
  const props = group.schema.properties
  for (const key of Object.keys(props)) assert.ok(key.startsWith('worlds.live-comments.'), `bad config path ${key}`)
  assert.equal(props['worlds.live-comments.ttsEnabled'].type, 'boolean')
  assert.equal(props['worlds.live-comments.selfSpeak']['x-options'], MODE_OPTIONS_KIND)
  assert.equal(props['worlds.live-comments.preset']['x-options'], PRESET_OPTIONS_KIND)
  assert.equal(props['worlds.live-comments.voice']['x-options'], VOICE_OPTIONS_KIND)
  assert.deepEqual(props['worlds.live-comments.rate'].enum, RATE_OPTIONS)
  for (const key of ['ttsEnabled', 'selfSpeak', 'preset', 'voice', 'rate', 'pitch', 'volume']) {
    assert.equal(props[`worlds.live-comments.${key}`]['x-hot'], true, `${key} 需要 x-hot`)
  }
})

test('设备选项表默认有系统默认项，读到的设备追加在后面', () => {
  assert.deepEqual(configOptions(DEVICE_OPTIONS_KIND), [{value: '', label: '系统默认设备'}])
  const rows = setDeviceRows([{index: 0, name: 'LegionZone 虚拟扬声器'}, {index: 1, name: 'CABLE Input'}])
  assert.equal(rows.length, 3)
  assert.equal(rows[0].value, '', '系统默认设备永远排第一')
  assert.deepEqual(rows.slice(1).map(r => r.value), ['LegionZone 虚拟扬声器', 'CABLE Input'])
  assert.deepEqual(configOptions(DEVICE_OPTIONS_KIND), rows)
  assert.equal(deviceOptionRows().length, 3)
  setDeviceRows([])
  assert.deepEqual(deviceOptionRows(), [{value: '', label: '系统默认设备'}])
})

test('播放设备在设置分组里是热生效的下拉框', () => {
  const [group] = speechConfigGroups('live-comments')
  const field = group.schema.properties['worlds.live-comments.outputDevice']
  assert.ok(field, '缺少播放设备设置')
  assert.equal(field.type, 'string')
  assert.equal(field['x-options'], DEVICE_OPTIONS_KIND)
  assert.equal(field['x-hot'], true)
})

test('Coo 事件只挑 say/ask，读选项时带项目符号', () => {
  assert.equal(SELF_TYPE, 'desktop-pet.self')
  assert.ok(SCAN_MS > 0)
  const say = {type: SELF_TYPE, meta: {kind: 'say', beats: ['第一句', {text: '第二句'}, '']}}
  assert.equal(lineOf(say), '第一句。 第二句')
  const ask = {type: SELF_TYPE, meta: {kind: 'ask', question: '要不要继续', options: ['继续', '停']}}
  assert.equal(lineOf(ask), '要不要继续（继续、停）')
  assert.equal(lineOf(ask, false), '要不要继续')
  assert.equal(lineOf({type: SELF_TYPE, meta: {kind: 'say', beats: []}}), '')
  assert.equal(lineOf({type: 'other.event', meta: {kind: 'say', beats: ['不该念']}}), '')
  assert.equal(lineOf({type: SELF_TYPE, meta: {kind: 'tool'}}), '')
})
