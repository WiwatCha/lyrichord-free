{
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mod = MA.mod12, NAMES = MA.NAMES;
const SOL = ['โด','โด#','เร','มีb','มี','ฟา','ฟา#','ซอล','ซอล#','ลา','ทีb','ที'];
const QLABEL = { '': 'เมเจอร์', m: 'ไมเนอร์' };
const IV_NAME = { 0: '1', 1: 'b9', 2: '9', 3: 'b3', 4: '3', 5: '4/11', 6: 'b5', 7: '5', 8: '#5', 9: '6/13', 10: 'b7', 11: '7' };
const LV_Q = { very: ['', 'm'], plus: ['', 'm', '2', 'sus2', 'sus4', '7', 'dim'], advance: MA.QS.map(x => x.q) };
const LV_NAME = { very: 'พื้นฐาน', plus: 'มาตรฐาน', advance: 'ละเอียด' };
const LV_HINT = { very: 'พื้นฐาน: 1 คอร์ดต่อห้อง เมเจอร์/ไมเนอร์ วนตามแพทเทิร์น เช่น Am', plus: 'มาตรฐาน: เพิ่ม 2, sus, 7, dim และเบสแยก (/) เช่น Am7, G/B', advance: 'ละเอียด: คอร์ดเต็ม เช่น maj7, m7b5, 9, 11, 13' };
const ICON = {
  demo: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  file: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>',
  tab: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
  grow: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', shrink: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>' };
const svgI = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${ICON[k]}</svg>`;
const KIND = { demo: 'ตัวอย่าง', file: 'ไฟล์', mic: 'ไมค์', tab: 'แท็บ' };
const LINKED = '';  // no linked sources in Lyrichord Free

const SHAPES = {
  '': [[-1,3,2,0,1,0],[-1,4,6,6,6,4],[-1,-1,0,2,3,2],[-1,6,8,8,8,6],[0,2,2,1,0,0],[1,3,3,2,1,1],[2,4,4,3,2,2],[3,2,0,0,0,3],[4,6,6,5,4,4],[-1,0,2,2,2,0],[-1,1,3,3,3,1],[-1,2,4,4,4,2]],
  m:  [[-1,3,5,5,4,3],[-1,4,6,6,5,4],[-1,-1,0,2,3,1],[-1,6,8,8,7,6],[0,2,2,0,0,0],[1,3,3,1,1,1],[2,4,4,2,2,2],[3,5,5,3,3,3],[4,6,6,4,4,4],[-1,0,2,2,1,0],[-1,1,3,3,2,1],[-1,2,4,4,3,2]]
};
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
const pick = (v, ok, d) => ok.includes(v) ? v : d;
// default: Thai for a Thai browser language or a Thai time zone (many Thai PCs run an English Chrome), else English
const thaiUser = () => { try { return (navigator.languages || [navigator.language]).some(l => /^th/i.test(l || '')) || /Bangkok/.test(Intl.DateTimeFormat().resolvedOptions().timeZone || ''); } catch (e) { return false; } };
let LANG = pick(store.get('cl-lang'), ['th', 'en'], thaiUser() ? 'th' : 'en');
const APP_VERSION = /*VERSION*/'dev';
// 'free' = Lyrichord Free (given away: files and live audio only, simple mode first, consent on first use); set by build.py --edition
const EDITION = /*EDITION*/'full';
const APP_NAME = EDITION === 'free' ? 'Lyrichord Free' : 'Lyrichord';
const ONLINE_PAGE = /*ONLINE*/false; // true in the copy on Cloudflare (tools/make_pages.py)
const I18N = /*I18N*/{ en: {}, rx: [] };
const I18N_RX = I18N.rx.map(([p, r]) => [new RegExp(p), r]);
// T(thai) -> English when the UI is in English; keys are the Thai strings themselves (dictionary in web/i18n/en.json)
function T(th) {
  if (LANG !== 'en' || typeof th !== 'string') return th;
  const v = I18N.en[th]; if (v != null) return v;
  for (const [rx, en] of I18N_RX) if (rx.test(th)) return th.replace(rx, en);
  return th;
}
const S = { sources: [], active: null, seq: 0, backend: null, cur: -2, curLine: -2, lastKey: '', loop: false, edit: null, tap: null,
  level: pick(store.get('cl-level'), ['very', 'plus', 'advance'], 'very'), inst: pick(store.get('cl-inst2'), ['guitar', 'piano'], 'piano'), exDiag: pick(store.get('cl-exdiag'), ['end', 'top', 'none'], 'end'),
  disp: pick(store.get('cl-disp2'), ['chord', 'lyric'], 'lyric'),
  layout: pick(store.get('cl-layout'), ['tb', 'lr'], 'tb'), dockW: Math.max(260, +store.get('cl-dockw') || Math.round(innerWidth * 0.42)), recs: [], dockH: Math.max(120, +store.get('cl-dockh') || Math.round(Math.max(220, Math.min(340, innerHeight * 0.36)))),
  ptab: pick(store.get('cl-ptab'), ['sheet', 'play'], 'sheet'),
  pro: (store.get('cl-pro') ?? (EDITION === 'free' ? '0' : '1')) === '1',
  view: 'split', dock: pick(store.get('cl-dock'), ['hide', 'normal', 'tall'], innerWidth < 600 || EDITION === 'free' ? 'hide' : 'normal'),
  follow: store.get('cl-follow') !== '0', userScrollAt: 0, lyPanel: false, lyPaste: false, stripChords: store.get('cl-strip') !== '0', exMode: null };
const audio = new Audio(); audio.preservesPitch = true;
const A = () => S.sources.find(s => s.id === S.active) || null;
const isLive = s => s && (s.kind === 'mic' || s.kind === 'tab');
const ready = s => s && !isLive(s) && s.status === 'ready';
const trOf = s => (s && s.tr) || 0;
// chords as played: with a guitar capo on fret n the hands play shapes n semitones lower (key and melody stay as heard)
const capoOf = s => (S.inst === 'guitar' && s && s.capo) || 0;
const ctr = s => trOf(s) - capoOf(s);
const hue = r => (mod(r * 7) * 30 + 8) % 360;
const lmode = () => S.level === 'very' ? 'very' : 'advance';
const nm = (c, s = A()) => !c || c.root < 0 ? '—' : MA.name(c, 0, lmode(), ctr(s));
const noteName = m => NAMES[mod(Math.round(m) + trOf(A()))];
const fmt = t => { t = Math.max(0, t || 0); return Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0'); };
const same = (a, b) => a.root === b.root && a.q === b.q && (a.bass ?? -1) === (b.bass ?? -1);
const minorish = c => c && c.root >= 0 && MA.baseOf(c.q) === 'm';
const segWords = t => (window.Intl && Intl.Segmenter) ? [...new Intl.Segmenter('th', { granularity: 'word' }).segment(t)].map(x => x.segment) : t.split(/(\s+)/).filter(Boolean);
function hint(t, err) { $('#hint').textContent = t || ''; $('#hint').className = 'hint' + (err ? ' err' : ''); }
