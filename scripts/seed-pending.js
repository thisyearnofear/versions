// One-off: submit a single unrated submission so the queue has something
// to show for the screenshot. The seed script publishes everything, so
// we need a fresh awaiting_curation row to demonstrate the curator view.
const http = require('http');
const crypto = require('crypto');
const nacl = require('tweetnacl');
const bs58 = require('bs58');

const PORT = process.env.PORT || 8080;
function req(method, path, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port: PORT, method, path, headers: { 'Content-Type': 'application/json', ...(data ? {'Content-Length': Buffer.byteLength(data)} : {}) } }, (res) => {
      let b = '';
      res.on('data', (c) => b += c);
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    if (data) r.write(data);
    r.end();
  });
}

async function main() {
const kp = nacl.sign.keyPair();
const wallet = bs58.encode(kp.publicKey);
const sig = Buffer.from(nacl.sign.detached(Buffer.from('VERSIONS_LEPTON_SUBMIT', 'utf8'), kp.secretKey)).toString('base64');

const audio = Buffer.alloc(8000, 0);
const wav = Buffer.alloc(44 + audio.length);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + audio.length, 4); wav.write('WAVE', 8);
wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34);
wav.write('data', 36); wav.writeUInt32LE(audio.length, 40);

const sub = await req('POST', '/api/v1/submissions', {
  artistWallet: wallet,
  signature: sig,
  metadata: { title: 'Tumbling Dice (Acoustic Blues)', artistName: 'JRich', versionType: 'acoustic', genre: 'Blues', mood: 'Euphoric' },
  audio: { contentType: 'audio/wav', base64: wav.toString('base64'), durationSeconds: 1 }
});
const id = JSON.parse(sub.body).data.id;
const txHash = '0x' + crypto.randomBytes(32).toString('hex');
const verify = await req('POST', `/api/v1/submissions/${id}/verify-payment`, { txHash });
console.log('verify:', verify.status);
}

main();
