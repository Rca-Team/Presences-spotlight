import https from 'https';

const ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const PROJECT_ID = '6accbd5d00053c5c1ac2';
const API_KEY = 'standard_55bab39a3e91d92a3e3a23486379c4e42e910ad194f438a60a1c6a5f5863da755e5ce018722c52afc8f7cba9a55c15a311885b5a464594902faa3c9a875fe01a0d38bfddbcc428da6564044525dc674eea4632a18faf296feb7e17cc95cf2567be465521bd068332f87740dc879b200964f79de960ca2a4c31e183cc72671958';
const DATABASE_ID = 'presences_db';

function appwriteRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(ENDPOINT + path);
    const bodyStr = body ? JSON.stringify(body) : null;
    const headers = {
      'X-Appwrite-Project': PROJECT_ID,
      'X-Appwrite-Key': API_KEY,
      'Content-Type': 'application/json',
    };
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            resolve({ status: res.statusCode, data: text ? JSON.parse(text) : {} });
          } catch {
            resolve({ status: res.statusCode, data: text });
          }
        });
      }
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function parseDescriptor(raw) {
  if (!raw) return null;
  try {
    if (Array.isArray(raw)) {
      return raw.length >= 64 ? Float32Array.from(raw.map(Number)) : null;
    }
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (trimmed.startsWith('[')) {
        const arr = JSON.parse(trimmed);
        return Array.isArray(arr) && arr.length >= 64 ? Float32Array.from(arr.map(Number)) : null;
      }
      const parts = trimmed.split(',').map((s) => parseFloat(s.trim())).filter((n) => !Number.isNaN(n));
      return parts.length >= 64 ? Float32Array.from(parts) : null;
    }
    return null;
  } catch {
    return null;
  }
}

function euclideanDistance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function selectKeepersAndSummary(rows, maxKeepers = 7) {
  const parsedRows = [];
  for (const r of rows) {
    const vec = parseDescriptor(r.descriptor);
    if (vec) parsedRows.push({ row: r, vec });
  }
  if (parsedRows.length === 0) return null;

  // Group by dimension and keep dominant dimension (128 for face-api.js)
  const dimGroups = new Map();
  for (const item of parsedRows) {
    const group = dimGroups.get(item.vec.length) || [];
    group.push(item);
    dimGroups.set(item.vec.length, group);
  }
  let dominantGroup = [];
  for (const [, group] of dimGroups) {
    if (group.length > dominantGroup.length) dominantGroup = group;
  }
  if (dominantGroup.length === 0) return null;

  const dim = dominantGroup[0].vec.length;
  const mean = new Float32Array(dim);
  for (const item of dominantGroup) {
    for (let i = 0; i < dim; i++) mean[i] += item.vec[i];
  }
  for (let i = 0; i < dim; i++) mean[i] /= dominantGroup.length;

  let inlierItems = dominantGroup;
  if (dominantGroup.length > 3) {
    const dists = dominantGroup.map((item) => euclideanDistance(item.vec, mean));
    const sorted = [...dists].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const cutoff = Math.max(median * 2.5, 0.08);
    const filtered = dominantGroup.filter((_, idx) => dists[idx] <= cutoff);
    if (filtered.length > 0) inlierItems = filtered;
  }

  const centroid = new Float32Array(dim);
  for (const item of inlierItems) {
    for (let i = 0; i < dim; i++) centroid[i] += item.vec[i];
  }
  for (let i = 0; i < dim; i++) centroid[i] /= inlierItems.length;

  // Deduplicate near-identical burst captures (< 0.042 distance or identical URL with < 0.08 distance)
  const distinctPool = [];
  for (const candidate of inlierItems) {
    const isDup = distinctPool.some((kept) => {
      const d = euclideanDistance(kept.vec, candidate.vec);
      if (d < 0.042) return true;
      if (candidate.row.image_url && kept.row.image_url === candidate.row.image_url && d < 0.08) return true;
      return false;
    });
    if (!isDup) distinctPool.push(candidate);
  }
  if (distinctPool.length === 0) distinctPool.push(inlierItems[0]);

  // Select up to maxKeepers diverse pose rows via farthest-point sampling starting from closest-to-centroid
  const keepers = [];
  if (distinctPool.length <= maxKeepers) {
    keepers.push(...distinctPool);
  } else {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < distinctPool.length; i++) {
      const d = euclideanDistance(distinctPool[i].vec, centroid);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const chosen = new Set([bestIdx]);
    keepers.push(distinctPool[bestIdx]);

    while (keepers.length < maxKeepers && chosen.size < distinctPool.length) {
      let farthestIdx = -1;
      let maxMinDist = -1;
      for (let i = 0; i < distinctPool.length; i++) {
        if (chosen.has(i)) continue;
        let minDist = Infinity;
        for (const k of keepers) {
          const d = euclideanDistance(distinctPool[i].vec, k.vec);
          if (d < minDist) minDist = d;
        }
        if (minDist > maxMinDist) {
          maxMinDist = minDist;
          farthestIdx = i;
        }
      }
      if (farthestIdx === -1) break;
      chosen.add(farthestIdx);
      keepers.push(distinctPool[farthestIdx]);
    }
  }

  const keeperIds = new Set(keepers.map((k) => k.row.$id));
  const redundantRows = rows.filter((r) => !keeperIds.has(r.$id));
  const roundVec = (vec) => Array.from(vec, (v) => Number(v.toFixed(5)));

  return {
    centroid_descriptor: roundVec(centroid),
    exemplar_descriptors: keepers.slice(0, 5).map((k) => roundVec(k.vec)),
    sample_count: keepers.length,
    keepers,
    redundantRows,
  };
}

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

async function main() {
  console.log('🚀 Fetching profiles and face_descriptors from Appwrite (6accbd5d00053c5c1ac2)...');
  const profRes = await appwriteRequest(
    `/databases/${DATABASE_ID}/collections/profiles/documents?queries[]=` +
      encodeURIComponent(JSON.stringify({ method: 'limit', values: [500] }))
  );
  const profiles = profRes.data?.documents || [];

  const fdRes = await appwriteRequest(
    `/databases/${DATABASE_ID}/collections/face_descriptors/documents?queries[]=` +
      encodeURIComponent(JSON.stringify({ method: 'limit', values: [1000] }))
  );
  const descriptors = fdRes.data?.documents || [];

  console.log(`Loaded ${profiles.length} profiles and ${descriptors.length} face_descriptors.`);

  const profileByKey = new Map();
  for (const p of profiles) {
    if (p.admission_number) profileByKey.set(`sid:${norm(p.admission_number)}`, p);
    if (p.employee_id) profileByKey.set(`sid:${norm(p.employee_id)}`, p);
    if (p.user_id) profileByKey.set(`uid:${norm(p.user_id)}`, p);
    if (p.$id) profileByKey.set(`uid:${norm(p.$id)}`, p);
    if (p.full_name) profileByKey.set(`name:${norm(p.full_name)}`, p);
    if (p.display_name) profileByKey.set(`name:${norm(p.display_name)}`, p);
  }

  const rowsByProfileId = new Map();
  const glassesByProfileId = new Map();

  for (const row of descriptors) {
    const sid = norm(row.student_id);
    const uid = norm(row.user_id);
    const name = norm(row.student_name || row.label);

    const matchedProfile =
      (sid && profileByKey.get(`sid:${sid}`)) ||
      (uid && profileByKey.get(`uid:${uid}`)) ||
      (name && profileByKey.get(`name:${name}`));

    if (!matchedProfile) continue;

    const pid = matchedProfile.$id;
    if (!rowsByProfileId.has(pid)) {
      rowsByProfileId.set(pid, []);
      glassesByProfileId.set(pid, new Set());
    }
    rowsByProfileId.get(pid).push(row);

    try {
      const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
      if (meta && (meta.glasses === 'with' || meta.glasses === 'without')) {
        glassesByProfileId.get(pid).add(meta.glasses);
      }
    } catch {}
  }

  let totalDeleted = 0;
  let totalKept = 0;
  let updatedProfiles = 0;

  for (const profile of profiles) {
    const pid = profile.$id;
    const studentRows = rowsByProfileId.get(pid) || [];
    if (studentRows.length === 0) continue;

    const result = selectKeepersAndSummary(studentRows, 7);
    if (!result) continue;

    totalKept += result.keepers.length;

    // Delete redundant burst duplicates in parallel batches of 10
    for (let i = 0; i < result.redundantRows.length; i += 10) {
      const batch = result.redundantRows.slice(i, i + 10);
      await Promise.all(
        batch.map(async (dup) => {
          const delRes = await appwriteRequest(
            `/databases/${DATABASE_ID}/collections/face_descriptors/documents/${dup.$id}`,
            'DELETE'
          );
          if (delRes.status === 204 || delRes.status === 200) totalDeleted++;
        })
      );
    }

    const glassesSet = glassesByProfileId.get(pid) || new Set();
    let existingMeta = {};
    try {
      existingMeta =
        typeof profile.metadata === 'string'
          ? JSON.parse(profile.metadata)
          : profile.metadata || {};
    } catch {
      existingMeta = {};
    }

    const updatedMeta = {
      ...existingMeta,
      biometric_summary: {
        version: 1,
        centroid_descriptor: result.centroid_descriptor,
        exemplar_descriptors: result.exemplar_descriptors,
        sample_count: result.sample_count,
        has_glasses_profile: glassesSet.has('with') && glassesSet.has('without'),
        updated_at: new Date().toISOString(),
      },
    };

    const updRes = await appwriteRequest(
      `/databases/${DATABASE_ID}/collections/profiles/documents/${pid}`,
      'PATCH',
      { data: { metadata: JSON.stringify(updatedMeta) } }
    );
    if (updRes.status === 200) updatedProfiles++;
  }

  console.log(`✅ Deduplication & Centroid Optimization Complete!`);
  console.log(`   • Profiles updated with biometric_summary : ${updatedProfiles}`);
  console.log(`   • Distinct pose exemplars kept in DB      : ${totalKept}`);
  console.log(`   • Redundant burst duplicates removed      : ${totalDeleted}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
