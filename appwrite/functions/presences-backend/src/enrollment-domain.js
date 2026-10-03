import { createHash, randomBytes } from 'node:crypto';

export const hash = value => createHash('sha256').update(String(value)).digest('hex').slice(0, 36);
export const token = () => randomBytes(32).toString('hex');
export const reject = (status, message) => { throw Object.assign(new Error(message), { status }); };
export const normalizeName = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
export function phoneNumber(value) {
  const number = String(value || '').replace(/[\s()-]/g, '');
  if (/^[6-9]\d{9}$/.test(number)) return '+91' + number;
  return /^\+[1-9]\d{7,14}$/.test(number) ? number : '';
}
export const fields = ['name', 'admission_number', 'class', 'section', 'father_name', 'mother_name', 'parent_phone', 'date_of_birth', 'address'];
export const poses = ['front', 'left', 'right', 'up', 'down', 'up-left', 'up-right', 'down-left', 'down-right'];
export function cleanStudent(input) {
  const row = Object.fromEntries(fields.map(key => [key, String(input?.[key] || '').normalize('NFKC').trim().slice(0, key === 'address' ? 250 : 120)]));
  if (!row.name || !/^[\w./-]{1,64}$/.test(row.admission_number)) reject(400, 'Name and a valid admission number are required.');
  if (row.parent_phone && !phoneNumber(row.parent_phone)) reject(400, 'Parent phone must include a valid country code.');
  row.parent_phone = phoneNumber(row.parent_phone);
  return row;
}
export function validateSample(sample) {
  if (!poses.includes(sample?.pose) || !['with', 'without'].includes(sample.glasses)) reject(400, 'Invalid capture pose.');
  if (!Array.isArray(sample.descriptor) || sample.descriptor.length !== 128 || sample.descriptor.some(x => !Number.isFinite(x) || Math.abs(x) > 10)) reject(400, 'Invalid face descriptor.');
  const q = sample.quality;
  if (!q || !Number.isFinite(q.brightness) || q.brightness < 35 || q.brightness > 225 || !Number.isFinite(q.sharpness) || q.sharpness < 25 || q.faces !== 1) reject(400, 'Capture quality checks failed.');
  if (typeof sample.image !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(sample.image) || sample.image.length > 550000) reject(400, 'Invalid or oversized face image.');
  const bytes = Buffer.from(sample.image.split(',')[1], 'base64');
  if (bytes.length < 500 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) reject(400, 'A JPEG image is required.');
  return bytes;
}
export function validateCapture(samples, wearsGlasses) {
  const required = poses.map(pose => pose + ':' + (wearsGlasses ? 'with' : 'without'));
  if (wearsGlasses) required.push('front:without');
  if (samples.length !== required.length || required.some(key => !samples.find(s => s.pose + ':' + s.glasses === key))) reject(400, 'Complete every guided view before saving.');
  const first = samples.find(s => s.pose === 'front').descriptor;
  if (samples.some(s => Math.hypot(...s.descriptor.map((v, i) => v - first[i])) > 0.65)) reject(400, 'Face samples do not match. Please recapture.');
  return Array.from({ length: 128 }, (_, i) => samples.reduce((sum, s) => sum + s.descriptor[i], 0) / samples.length);
}
