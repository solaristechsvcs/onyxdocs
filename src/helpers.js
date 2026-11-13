function escape(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function slug(value) { return String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 180); }
function categoryTree(rows) {
  const byId = new Map(rows.map(r => [r.id, {...r, children: []}]));
  const roots = [];
  for (const row of byId.values()) { const parent = byId.get(row.parent_id); if (parent) parent.children.push(row); else roots.push(row); }
  return roots;
}
function validParent(rows, id, parent) {
  const seen = new Set([Number(id)]);
  while (parent) { if (seen.has(Number(parent))) return false; seen.add(Number(parent)); const row = rows.find(r => r.id === Number(parent)); if (!row) return false; parent = row.parent_id; }
  return true;
}
module.exports = {escape, slug, categoryTree, validParent};
