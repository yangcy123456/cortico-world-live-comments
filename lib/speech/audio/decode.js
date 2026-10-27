/**
 * MP3 → WAV16, decoded in-process by a wasm build (mpg123-decoder, no native dependency).
 *
 * Why decode at all: on Windows the only way to play to a *chosen* output device is waveOut, and
 * waveOut only eats PCM, while the Edge engine hands back MP3. Decoding here and handing a WAV to
 * the native player is what makes "play into a virtual speaker" possible.
 *
 * The decoder is imported lazily: on a machine where the dependency is missing the extension still
 * speaks, it just falls back to the system default device through the MCI player.
 */
let decoderModule=null

async function loadDecoder(){
  if(!decoderModule){
    try{
      decoderModule=await import('mpg123-decoder')
    }catch(err){
      throw new Error(`缺少 mpg123-decoder 依赖，无法解码 MP3：${err instanceof Error?err.message:String(err)}`)
    }
  }
  return decoderModule
}

/** Packs 16-bit PCM frames (float channel data) into a WAV file. */
export function buildWav(channelData,samples,sampleRate){
  const channels=channelData.length
  const frames=samples
  const dataBytes=frames*channels*2
  const buffer=Buffer.alloc(44+dataBytes)
  buffer.write('RIFF',0,'ascii')
  buffer.writeUInt32LE(36+dataBytes,4)
  buffer.write('WAVE',8,'ascii')
  buffer.write('fmt ',12,'ascii')
  buffer.writeUInt32LE(16,16)
  buffer.writeUInt16LE(1,20)
  buffer.writeUInt16LE(channels,22)
  buffer.writeUInt32LE(sampleRate,24)
  buffer.writeUInt32LE(sampleRate*channels*2,28)
  buffer.writeUInt16LE(channels*2,32)
  buffer.writeUInt16LE(16,34)
  buffer.write('data',36,'ascii')
  buffer.writeUInt32LE(dataBytes,40)
  let offset=44
  for(let i=0;i<frames;i+=1){
    for(let c=0;c<channels;c+=1){
      const sample=channelData[c][i]??0
      const clamped=sample>1?1:sample<-1?-1:sample
      buffer.writeInt16LE(Math.round(clamped*32767),offset)
      offset+=2
    }
  }
  return buffer
}

/** @param {Uint8Array} bytes MP3 data */
export async function mp3ToWav(bytes){
  const {MPEGDecoder}=await loadDecoder()
  const decoder=new MPEGDecoder()
  await decoder.ready
  try{
    const {channelData,samplesDecoded,sampleRate}=decoder.decode(new Uint8Array(bytes))
    if(!samplesDecoded||!channelData?.length)throw new Error('MP3 解码结果为空')
    return {
      bytes:buildWav(channelData,samplesDecoded,sampleRate),
      sampleRate,
      channels:channelData.length,
      seconds:samplesDecoded/sampleRate,
    }
  }finally{
    try{
      decoder.free()
    }catch{}
  }
}
