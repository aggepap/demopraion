/**
 * Demo content: a small but realistic catalogue for showing the site off —
 * products (one with variations), stays with seasonal rates, blog posts with
 * authors, FAQs, case studies and a Greek shipping zone.
 *
 *   npm run db:seed-demo              create what is missing, published
 *   npm run db:seed-demo -- --force   also overwrite demo documents already present
 *
 * Run after `db:seed-site`. It moves that seed's placeholder samples back to
 * draft so they do not sit next to the demo content. Re-running is safe.
 * Afterwards `npm run db:snapshot-content` captures everything for other setups.
 */
import '@/cms/db/adapters/mysql/load-env';

import { and, eq, inArray } from 'drizzle-orm';

import type { DocumentWriteInput } from '@/cms/core/documents/service';
import { getDb, schema } from '@/cms/db';
import { applySeedDocument, resolveTranslationGroupId } from '@/cms/db/seeds/documents';
import { formatSeedSummary, parseSeedMode, tally, type SeedCounts, type SeedMode } from '@/cms/db/seeds/seed-mode';
import config from '@/site.config';

import { DEFAULT_LOCALE, LOCALES } from './data';

type L = { el: string; en: string };

const mode: SeedMode = parseSeedMode(process.argv.slice(2));
const counts: SeedCounts = { created: 0, updated: 0, skipped: 0 };
const published = (): Pick<DocumentWriteInput, 'status' | 'publishedAt'> => ({ status: 'published', publishedAt: new Date() });

/** TipTap rich text, one paragraph per string. */
function richText(...paragraphs: string[]) {
  return {
    type: 'doc',
    content: paragraphs.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
  };
}

const pick = (l: string, v: L) => (l === 'el' ? v.el : v.en);

async function seedDoc(type: string, slug: string, locale: string, input: Omit<DocumentWriteInput, 'slug' | 'locale'>) {
  tally(counts, await applySeedDocument(config, type, slug, locale, mode, { slug, locale, ...input }));
}

/** One document per locale, all in one translation group. */
async function seedGroup(type: string, slug: string, dataFor: (locale: string) => Record<string, unknown>) {
  const translationGroupId = await resolveTranslationGroupId(type, slug);
  for (const locale of LOCALES) await seedDoc(type, slug, locale, { ...published(), translationGroupId, data: dataFor(locale) });
}

async function idOf(type: string, slug: string, locale: string = DEFAULT_LOCALE): Promise<number> {
  const [row] = await getDb()
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(and(eq(schema.documents.type, type), eq(schema.documents.slug, slug), eq(schema.documents.locale, locale)))
    .limit(1);
  if (!row) throw new Error(`missing ${type}/${slug}/${locale}`);
  return row.id;
}

/** Taxonomy terms: one document in the default locale with a title per locale. Returns slug → id. */
async function seedTerms(type: string, terms: Array<[string, L]>): Promise<Record<string, number>> {
  const ids: Record<string, number> = {};
  for (const [slug, title] of terms) {
    await seedDoc(type, slug, DEFAULT_LOCALE, { ...published(), data: { title } });
    ids[slug] = await idOf(type, slug);
  }
  return ids;
}

// ── Shop ────────────────────────────────────────────────────────────────────

interface DemoProduct {
  slug: string;
  title: L;
  subtitle: L;
  description: [L, L];
  category: string;
  price: number;
  compareAtPrice?: number;
  stock?: number;
  availability?: 'in-stock' | 'out-of-stock' | 'preorder' | 'made-to-order';
  featured?: boolean;
  badges?: Array<'new' | 'bestseller'>;
  sku: string;
  weight: number;
  specs?: Array<[L, string]>;
  extra?: Record<string, unknown>;
}

const PRODUCT_CATEGORIES: Array<[string, L]> = [
  ['ceramics', { el: 'Κεραμικά', en: 'Ceramics' }],
  ['pantry', { el: 'Παντοπωλείο', en: 'Pantry' }],
  ['clothing', { el: 'Ρούχα', en: 'Clothing' }],
  ['home', { el: 'Σπίτι', en: 'Home' }],
];

const SIZES = [
  ['s', 'S'],
  ['m', 'M'],
  ['l', 'L'],
] as const;
const COLOURS = [
  ['white', { el: 'Λευκό', en: 'White' }, '#f5f3ee'],
  ['blue', { el: 'Μπλε', en: 'Aegean blue' }, '#1f4e79'],
] as const;

/** Colour × size, each with its own SKU and stock; blue is a little dearer. */
const TEE_VARIANTS = {
  attributes: [
    {
      id: 'colour',
      name: { el: 'Χρώμα', en: 'Colour' },
      swatchType: 'color',
      filterDisplay: 'auto',
      values: COLOURS.map(([id, label, color]) => ({ id, label, color })),
    },
    {
      id: 'size',
      name: { el: 'Μέγεθος', en: 'Size' },
      swatchType: 'button',
      filterDisplay: 'auto',
      values: SIZES.map(([id, label]) => ({ id, label: { el: label, en: label } })),
    },
  ],
  variations: COLOURS.flatMap(([c]) =>
    SIZES.map(([s]) => ({
      id: `${c}-${s}`,
      options: { colour: c, size: s },
      sku: `TEE-${c.toUpperCase()}-${s.toUpperCase()}`,
      price: c === 'blue' ? 32 : 29,
      stock: s === 'l' && c === 'blue' ? 0 : 12,
      enabled: true,
    })),
  ),
};

const LINEN_VARIANTS = {
  attributes: [
    {
      id: 'size',
      name: { el: 'Μέγεθος', en: 'Size' },
      swatchType: 'button',
      filterDisplay: 'auto',
      values: SIZES.map(([id, label]) => ({ id, label: { el: label, en: label } })),
    },
  ],
  variations: SIZES.map(([s]) => ({ id: s, options: { size: s }, sku: `LIN-SH-${s.toUpperCase()}`, stock: 6, enabled: true })),
};

const PRODUCTS: DemoProduct[] = [
  {
    slug: 'aegean-serving-bowl',
    title: { el: 'Μπολ σερβιρίσματος Αιγαίο', en: 'Aegean serving bowl' },
    subtitle: { el: 'Χειροποίητο, σμάλτο σε μπλε του Αιγαίου', en: 'Hand-thrown, glazed in Aegean blue' },
    description: [
      { el: 'Γυρισμένο στον τροχό σε εργαστήριο της Σίφνου.', en: 'Thrown on the wheel in a Sifnos workshop.' },
      { el: 'Κατάλληλο για πλυντήριο πιάτων. Κάθε κομμάτι είναι μοναδικό.', en: 'Dishwasher safe. Every piece is one of a kind.' },
    ],
    category: 'ceramics',
    price: 48,
    stock: 14,
    featured: true,
    badges: ['bestseller'],
    sku: 'CER-BOWL-01',
    weight: 1.2,
    specs: [
      [{ el: 'Υλικό', en: 'Material' }, 'Stoneware'],
      [{ el: 'Διάμετρος', en: 'Diameter' }, '28 cm'],
    ],
  },
  {
    slug: 'cycladic-mug-set',
    title: { el: 'Σετ 4 κούπες Κυκλάδες', en: 'Cycladic mug set of 4' },
    subtitle: { el: 'Τέσσερις αποχρώσεις του νησιού', en: 'Four shades of the island' },
    description: [
      { el: 'Τέσσερις κούπες 300 ml σε λευκό, άμμο, μπλε και ώχρα.', en: 'Four 300 ml mugs in white, sand, blue and ochre.' },
      { el: 'Συσκευασμένες σε κουτί δώρου.', en: 'Packed in a gift box.' },
    ],
    category: 'ceramics',
    price: 56,
    compareAtPrice: 68,
    stock: 20,
    sku: 'CER-MUG-SET4',
    weight: 1.6,
  },
  {
    slug: 'terracotta-planter',
    title: { el: 'Γλάστρα τερακότα', en: 'Terracotta planter' },
    subtitle: { el: 'Άβαφη, με πιατάκι', en: 'Unglazed, with saucer' },
    description: [
      { el: 'Κλασική γλάστρα από κόκκινο πηλό της Κρήτης.', en: 'A classic planter in red Cretan clay.' },
      { el: 'Αναπνέει, κρατά τις ρίζες δροσερές.', en: 'Breathes, keeping roots cool.' },
    ],
    category: 'ceramics',
    price: 22,
    stock: 30,
    sku: 'CER-PLANT-M',
    weight: 2.1,
  },
  {
    slug: 'extra-virgin-olive-oil',
    title: { el: 'Εξαιρετικό παρθένο ελαιόλαδο 750 ml', en: 'Extra virgin olive oil 750 ml' },
    subtitle: { el: 'Κορωνέικη, πρώιμη συγκομιδή', en: 'Koroneiki, early harvest' },
    description: [
      { el: 'Ψυχρής έκθλιψης από οικογενειακό ελαιώνα στη Μεσσηνία.', en: 'Cold-pressed from a family grove in Messinia.' },
      { el: 'Οξύτητα κάτω από 0,3%.', en: 'Acidity below 0.3%.' },
    ],
    category: 'pantry',
    price: 16.5,
    stock: 80,
    featured: true,
    badges: ['bestseller'],
    sku: 'PAN-OIL-750',
    weight: 1.3,
  },
  {
    slug: 'thyme-honey',
    title: { el: 'Θυμαρίσιο μέλι 450 g', en: 'Thyme honey 450 g' },
    subtitle: { el: 'Από τα βουνά της Νάξου', en: 'From the hills of Naxos' },
    description: [
      { el: 'Ωμό, αφιλτράριστο μέλι θυμαριού.', en: 'Raw, unfiltered thyme honey.' },
      { el: 'Κρυσταλλώνει φυσικά — ζεστάνετε ελαφρά σε μπεν μαρί.', en: 'Crystallises naturally — warm gently in a water bath.' },
    ],
    category: 'pantry',
    price: 14,
    stock: 45,
    badges: ['new'],
    sku: 'PAN-HONEY-450',
    weight: 0.6,
  },
  {
    slug: 'mountain-tea-bundle',
    title: { el: 'Τσάι του βουνού, δεμάτι', en: 'Mountain tea bundle' },
    subtitle: { el: 'Sideritis, λιαστό', en: 'Sideritis, sun-dried' },
    description: [
      { el: 'Μαζεμένο με το χέρι στον Ταΰγετο.', en: 'Hand-picked on Mount Taygetos.' },
      { el: 'Βράστε 5 λεπτά, σερβίρετε με μέλι.', en: 'Simmer for 5 minutes, serve with honey.' },
    ],
    category: 'pantry',
    price: 6.5,
    stock: 0,
    availability: 'out-of-stock',
    sku: 'PAN-TEA-01',
    weight: 0.1,
  },
  {
    slug: 'island-tee',
    title: { el: 'T-shirt Island', en: 'Island tee' },
    subtitle: { el: 'Οργανικό βαμβάκι, δύο χρώματα', en: 'Organic cotton, two colours' },
    description: [
      { el: 'Άνετη γραμμή από 100% οργανικό βαμβάκι.', en: 'A relaxed fit in 100% organic cotton.' },
      { el: 'Διαλέξτε χρώμα και μέγεθος — κάθε συνδυασμός έχει δικό του απόθεμα.', en: 'Pick a colour and a size — each combination has its own stock.' },
    ],
    category: 'clothing',
    price: 29,
    featured: true,
    badges: ['new'],
    sku: 'TEE',
    weight: 0.25,
    extra: TEE_VARIANTS,
  },
  {
    slug: 'linen-shirt',
    title: { el: 'Λινό πουκάμισο', en: 'Linen shirt' },
    subtitle: { el: 'Ελληνικό λινό, πλυμένο', en: 'Greek linen, stone-washed' },
    description: [
      { el: 'Ελαφρύ πουκάμισο για τις ζεστές μέρες.', en: 'A light shirt for hot days.' },
      { el: 'Διαθέσιμο σε S, M, L.', en: 'Available in S, M and L.' },
    ],
    category: 'clothing',
    price: 64,
    compareAtPrice: 79,
    sku: 'LIN-SH',
    weight: 0.3,
    extra: LINEN_VARIANTS,
  },
  {
    slug: 'straw-beach-hat',
    title: { el: 'Ψάθινο καπέλο', en: 'Straw beach hat' },
    subtitle: { el: 'Πλεγμένο στο χέρι', en: 'Hand-woven' },
    description: [
      { el: 'Φαρδύ γείσο για τον ήλιο του Αυγούστου.', en: 'A wide brim for the August sun.' },
      { el: 'Κατασκευάζεται κατά παραγγελία σε 10 ημέρες.', en: 'Made to order in 10 days.' },
    ],
    category: 'clothing',
    price: 38,
    availability: 'made-to-order',
    sku: 'HAT-STRAW',
    weight: 0.2,
  },
  {
    slug: 'linen-tablecloth',
    title: { el: 'Λινό τραπεζομάντιλο', en: 'Linen tablecloth' },
    subtitle: { el: '150 × 250 cm, φυσικό', en: '150 × 250 cm, natural' },
    description: [
      { el: 'Υφασμένο σε αργαλειό στο Σουφλί.', en: 'Loom-woven in Soufli.' },
      { el: 'Πλένεται στους 40°C.', en: 'Machine wash at 40°C.' },
    ],
    category: 'home',
    price: 72,
    stock: 8,
    sku: 'HOME-TCL-150',
    weight: 0.9,
  },
  {
    slug: 'olive-wood-board',
    title: { el: 'Ξύλο κοπής από ελιά', en: 'Olive wood board' },
    subtitle: { el: 'Κάθε νερά μοναδικά', en: 'Unique grain on every piece' },
    description: [
      { el: 'Από ξύλο ελιάς κλαδέματος, λαδωμένο.', en: 'From pruned olive wood, oiled.' },
      { el: 'Για σερβίρισμα και κοπή.', en: 'For serving and chopping.' },
    ],
    category: 'home',
    price: 34,
    stock: 18,
    featured: true,
    sku: 'HOME-OWB-40',
    weight: 1.1,
  },
  {
    slug: 'beeswax-candle',
    title: { el: 'Κερί από κερί μέλισσας', en: 'Beeswax candle' },
    subtitle: { el: 'Προπαραγγελία — νέα παρτίδα τον Οκτώβριο', en: 'Pre-order — new batch in October' },
    description: [
      { el: 'Χυτό στο χέρι, καίει 40 ώρες.', en: 'Hand-poured, burns for 40 hours.' },
      { el: 'Αποστέλλεται με τη νέα παρτίδα.', en: 'Ships with the new batch.' },
    ],
    category: 'home',
    price: 18,
    availability: 'preorder',
    sku: 'HOME-CANDLE',
    weight: 0.4,
  },
];

async function seedShop() {
  const cats = await seedTerms(
    'category',
    PRODUCT_CATEGORIES.map(([slug, title]) => [slug, title]),
  );
  for (const p of PRODUCTS) {
    await seedGroup('product', p.slug, (l) => ({
      title: pick(l, p.title),
      subtitle: pick(l, p.subtitle),
      description: richText(...p.description.map((d) => pick(l, d))),
      categories: [cats[p.category]],
      price: p.price,
      ...(p.compareAtPrice ? { compareAtPrice: p.compareAtPrice } : {}),
      ...(p.stock !== undefined ? { stock: p.stock } : {}),
      availability: p.availability ?? 'in-stock',
      featured: p.featured ?? false,
      ...(p.badges ? { badges: p.badges } : {}),
      sku: p.sku,
      weight: p.weight,
      weightUnit: 'kg',
      brand: 'Demo Site',
      condition: 'new',
      ...(p.specs ? { specs: p.specs.map(([label, value]) => ({ label: pick(l, label), value })) } : {}),
      ...(p.extra ?? {}),
    }));
  }
}

/** Greece, with courier delivery (free over €60) and shop pickup. Costs are in cents. */
async function seedShipping() {
  const db = getDb();
  const [existing] = await db.select().from(schema.shippingZones).where(eq(schema.shippingZones.name, 'Ελλάδα / Greece')).limit(1);
  if (existing) return console.log('✓ shipping zone already set — left alone');
  await db.insert(schema.shippingZones).values({ name: 'Ελλάδα / Greece', countries: ['GR'], sort: 0 });
  const [zone] = await db.select().from(schema.shippingZones).where(eq(schema.shippingZones.name, 'Ελλάδα / Greece')).limit(1);
  await db.insert(schema.shippingMethods).values([
    { zoneId: zone.id, name: 'Courier', courier: 'custom', kind: 'address', cost: 450, freeThreshold: 6000, etaMinDays: 1, etaMaxDays: 3, codAllowed: true, active: true, sort: 0 },
    { zoneId: zone.id, name: 'Παραλαβή από το κατάστημα / Shop pickup', courier: 'pickup', kind: 'pickup', cost: 0, codAllowed: true, active: true, sort: 1 },
  ]);
  console.log('✓ shipping zone Greece: courier €4.50 (free over €60) + shop pickup');
}

// ── Stays ───────────────────────────────────────────────────────────────────

interface DemoStay {
  slug: string;
  title: L;
  subtitle: L;
  description: [L, L];
  category: string;
  type: string;
  location: string;
  nightlyRate: number;
  highRate: number;
  minNights: number;
  baseOccupancy: number;
  maxOccupancy: number;
  extraGuestPerNight?: number;
  cleaningFee: number;
  bedrooms: number;
  checkInSaturday?: boolean;
}

const STAYS: DemoStay[] = [
  {
    slug: 'villa-thalassa',
    title: { el: 'Βίλα Θάλασσα', en: 'Villa Thalassa' },
    subtitle: { el: 'Πισίνα και θέα στο ηλιοβασίλεμα', en: 'Private pool and sunset views' },
    description: [
      { el: 'Τριάρι βίλα 200 μέτρα από την παραλία της Χρυσής Ακτής.', en: 'A three-bedroom villa 200 metres from Golden Beach.' },
      { el: 'Ιδιωτική πισίνα, κήπος με ελιές και καθημερινή καθαριότητα.', en: 'Private pool, an olive garden and daily housekeeping.' },
    ],
    category: 'villas',
    type: 'villa',
    location: 'paros',
    nightlyRate: 320,
    highRate: 480,
    minNights: 3,
    baseOccupancy: 4,
    maxOccupancy: 6,
    extraGuestPerNight: 30,
    cleaningFee: 80,
    bedrooms: 3,
    checkInSaturday: true,
  },
  {
    slug: 'villa-ampelos',
    title: { el: 'Βίλα Άμπελος', en: 'Villa Ampelos' },
    subtitle: { el: 'Ανάμεσα στα αμπέλια', en: 'Among the vineyards' },
    description: [
      { el: 'Πέτρινη βίλα στην ενδοχώρα της Σαντορίνης.', en: 'A stone villa in the Santorini countryside.' },
      { el: 'Γευσιγνωσία κρασιού στο κτήμα δίπλα.', en: 'Wine tasting at the estate next door.' },
    ],
    category: 'villas',
    type: 'villa',
    location: 'santorini',
    nightlyRate: 390,
    highRate: 560,
    minNights: 4,
    baseOccupancy: 4,
    maxOccupancy: 8,
    extraGuestPerNight: 40,
    cleaningFee: 100,
    bedrooms: 4,
  },
  {
    slug: 'naxos-harbour-apartment',
    title: { el: 'Διαμέρισμα στο λιμάνι της Νάξου', en: 'Naxos harbour apartment' },
    subtitle: { el: 'Δύο βήματα από την Πορτάρα', en: 'Steps from the Portara' },
    description: [
      { el: 'Φωτεινό δυάρι με μπαλκόνι πάνω από το λιμάνι.', en: 'A bright two-bedroom flat with a balcony over the harbour.' },
      { el: 'Ιδανικό για οικογένειες — εστιατόρια και παραλία με τα πόδια.', en: 'Ideal for families — restaurants and the beach on foot.' },
    ],
    category: 'apartments',
    type: 'apartment',
    location: 'naxos',
    nightlyRate: 140,
    highRate: 210,
    minNights: 2,
    baseOccupancy: 2,
    maxOccupancy: 5,
    extraGuestPerNight: 20,
    cleaningFee: 45,
    bedrooms: 2,
  },
  {
    slug: 'naoussa-studio',
    title: { el: 'Στούντιο στη Νάουσα', en: 'Naoussa studio' },
    subtitle: { el: 'Για δύο, στο κέντρο του χωριού', en: 'For two, in the heart of the village' },
    description: [
      { el: 'Κυκλαδίτικο στούντιο με αυλή.', en: 'A Cycladic studio with a courtyard.' },
      { el: 'Κλιματισμός, κουζινούλα, γρήγορο Wi-Fi.', en: 'Air conditioning, kitchenette, fast Wi-Fi.' },
    ],
    category: 'apartments',
    type: 'studio',
    location: 'paros',
    nightlyRate: 85,
    highRate: 130,
    minNights: 2,
    baseOccupancy: 2,
    maxOccupancy: 2,
    cleaningFee: 25,
    bedrooms: 1,
  },
  {
    slug: 'oia-cave-suite',
    title: { el: 'Σπηλιά-σουίτα στην Οία', en: 'Oia cave suite' },
    subtitle: { el: 'Υπαίθριο τζακούζι στην καλντέρα', en: 'Outdoor jacuzzi on the caldera' },
    description: [
      { el: 'Παραδοσιακή υπόσκαφη σουίτα με θέα στην καλντέρα.', en: 'A traditional cave suite looking over the caldera.' },
      { el: 'Πρωινό στη βεράντα κάθε μέρα.', en: 'Breakfast on the terrace every morning.' },
    ],
    category: 'apartments',
    type: 'studio',
    location: 'santorini',
    nightlyRate: 260,
    highRate: 420,
    minNights: 2,
    baseOccupancy: 2,
    maxOccupancy: 3,
    extraGuestPerNight: 50,
    cleaningFee: 0,
    bedrooms: 1,
  },
];

async function seedStays() {
  const categories = await seedTerms('booking_category', [
    ['villas', { el: 'Βίλες', en: 'Villas' }],
    ['apartments', { el: 'Διαμερίσματα & στούντιο', en: 'Apartments & studios' }],
  ]);
  const types = await seedTerms('vessel_type', [
    ['villa', { el: 'Βίλα', en: 'Villa' }],
    ['apartment', { el: 'Διαμέρισμα', en: 'Apartment' }],
    ['studio', { el: 'Στούντιο', en: 'Studio' }],
  ]);
  const locations = await seedTerms('departure_location', [
    ['paros', { el: 'Πάρος', en: 'Paros' }],
    ['naxos', { el: 'Νάξος', en: 'Naxos' }],
    ['santorini', { el: 'Σαντορίνη', en: 'Santorini' }],
  ]);

  for (const s of STAYS) {
    await seedGroup('booking', s.slug, (l) => ({
      kind: 'stay',
      title: pick(l, s.title),
      subtitle: pick(l, s.subtitle),
      description: richText(...s.description.map((d) => pick(l, d))),
      categories: [categories[s.category]],
      types: [types[s.type]],
      departures: [locations[s.location]],
      nightlyRate: s.nightlyRate,
      seasonalRates: [{ id: 'high', from: '07-01', to: '08-31', rate: s.highRate, minNights: Math.max(s.minNights, 5) }],
      minNights: s.minNights,
      ...(s.checkInSaturday ? { checkInDays: ['6'], checkOutDays: ['6'] } : {}),
      baseOccupancy: s.baseOccupancy,
      maxOccupancy: s.maxOccupancy,
      ...(s.extraGuestPerNight ? { extraGuestPerNight: s.extraGuestPerNight } : {}),
      childrenEnabled: s.maxOccupancy > 2,
      ...(s.maxOccupancy > 2 ? { childMaxAge: 12, childPerNight: 10 } : {}),
      fees: [
        ...(s.cleaningFee ? [{ id: 'cleaning', label: { el: 'Καθαριότητα', en: 'Cleaning fee' }, amount: s.cleaningFee, basis: 'per_stay' }] : []),
        { id: 'climate-tax', label: { el: 'Τέλος ανθεκτικότητας', en: 'Climate resilience fee' }, amount: 4, basis: 'per_night' },
      ],
      availableFrom: '04-15',
      availableTo: '10-31',
      capacityPerDay: 1,
      leadTimeHours: 48,
      maxAdvanceDays: 365,
      quickInfo: [
        { id: 'guests', icon: 'users', label: { el: 'Επισκέπτες', en: 'Guests' }, value: `${s.maxOccupancy}`, suffix: { el: 'άτομα', en: 'people' } },
        { id: 'bedrooms', icon: 'bed-double', label: { el: 'Υπνοδωμάτια', en: 'Bedrooms' }, value: `${s.bedrooms}` },
        { id: 'nights', icon: 'moon', label: { el: 'Ελάχιστη διαμονή', en: 'Minimum stay' }, value: `${s.minNights}`, suffix: { el: 'νύχτες', en: 'nights' } },
      ],
      depositPercent: 30,
      freeCancellationDays: 14,
      cancellationPolicy: richText(
        pick(l, {
          el: 'Δωρεάν ακύρωση έως 14 ημέρες πριν την άφιξη. Μετά, η προκαταβολή δεν επιστρέφεται.',
          en: 'Free cancellation up to 14 days before arrival. After that the deposit is non-refundable.',
        }),
      ),
    }));
  }
}

// ── Blog ────────────────────────────────────────────────────────────────────

const AUTHORS: Array<{ slug: string; name: L; jobTitle: L; summary: L }> = [
  {
    slug: 'eleni-marinou',
    name: { el: 'Ελένη Μαρίνου', en: 'Eleni Marinou' },
    jobTitle: { el: 'Επιμελήτρια ταξιδιών', en: 'Travel editor' },
    summary: { el: 'Γράφει για τα νησιά εδώ και δέκα χρόνια.', en: 'Has written about the islands for ten years.' },
  },
  {
    slug: 'nikos-alexiou',
    name: { el: 'Νίκος Αλεξίου', en: 'Nikos Alexiou' },
    jobTitle: { el: 'Υπεύθυνος προϊόντων', en: 'Head of products' },
    summary: { el: 'Ψάχνει μικρούς παραγωγούς σε όλη την Ελλάδα.', en: 'Seeks out small producers all over Greece.' },
  },
];

const ARTICLES: Array<{ slug: string; author: string; category: string; title: L; excerpt: L; body: [L, L] }> = [
  {
    slug: 'a-week-in-paros',
    author: 'eleni-marinou',
    category: 'travel',
    title: { el: 'Μια εβδομάδα στην Πάρο', en: 'A week in Paros' },
    excerpt: { el: 'Παραλίες, χωριά και πού να φάτε.', en: 'Beaches, villages and where to eat.' },
    body: [
      { el: 'Η Πάρος ισορροπεί ανάμεσα στη ζωντάνια και την ησυχία.', en: 'Paros balances liveliness and quiet.' },
      { el: 'Ξεκινήστε από τη Νάουσα και τελειώστε στη Λεύκες.', en: 'Start in Naoussa and end in Lefkes.' },
    ],
  },
  {
    slug: 'santorini-off-season',
    author: 'eleni-marinou',
    category: 'travel',
    title: { el: 'Σαντορίνη εκτός εποχής', en: 'Santorini off season' },
    excerpt: { el: 'Γιατί ο Οκτώβριος είναι ο καλύτερος μήνας.', en: 'Why October is the best month.' },
    body: [
      { el: 'Λιγότερος κόσμος, ζεστή θάλασσα, τρύγος.', en: 'Fewer crowds, warm sea, the grape harvest.' },
      { el: 'Κλείστε νωρίς — τα καλά καταλύματα γεμίζουν.', en: 'Book early — the good places fill up.' },
    ],
  },
  {
    slug: 'how-to-taste-olive-oil',
    author: 'nikos-alexiou',
    category: 'food',
    title: { el: 'Πώς δοκιμάζουμε ελαιόλαδο', en: 'How to taste olive oil' },
    excerpt: { el: 'Φρουτώδες, πικρό, πικάντικο: τι σημαίνουν.', en: 'Fruity, bitter, peppery: what they mean.' },
    body: [
      { el: 'Ζεστάνετε το ποτήρι στην παλάμη σας.', en: 'Warm the glass in your palm.' },
      { el: 'Το τσίμπημα στο λαιμό είναι καλό σημάδι.', en: 'A catch in the throat is a good sign.' },
    ],
  },
  {
    slug: 'meet-the-sifnos-potters',
    author: 'nikos-alexiou',
    category: 'makers',
    title: { el: 'Γνωρίστε τους κεραμίστες της Σίφνου', en: 'Meet the Sifnos potters' },
    excerpt: { el: 'Τρεις γενιές στον τροχό.', en: 'Three generations at the wheel.' },
    body: [
      { el: 'Το εργαστήριο λειτουργεί από το 1950.', en: 'The workshop has run since 1950.' },
      { el: 'Κάθε μπολ περνά από δύο ψησίματα.', en: 'Every bowl is fired twice.' },
    ],
  },
  {
    slug: 'honey-harvest-naxos',
    author: 'nikos-alexiou',
    category: 'food',
    title: { el: 'Ο τρύγος του μελιού στη Νάξο', en: 'The honey harvest on Naxos' },
    excerpt: { el: 'Μια μέρα με έναν μελισσοκόμο.', en: 'A day with a beekeeper.' },
    body: [
      { el: 'Το θυμάρι ανθίζει τον Ιούνιο.', en: 'Thyme flowers in June.' },
      { el: 'Ο τρύγος γίνεται νωρίς το πρωί.', en: 'The harvest starts at dawn.' },
    ],
  },
  {
    slug: 'packing-list-for-the-islands',
    author: 'eleni-marinou',
    category: 'travel',
    title: { el: 'Τι να πάρετε μαζί σας στα νησιά', en: 'What to pack for the islands' },
    excerpt: { el: 'Λινό, καπέλο και ένα καλό βιβλίο.', en: 'Linen, a hat and a good book.' },
    body: [
      { el: 'Ο αέρας του Αιγαίου είναι δυνατός — πάρτε κάτι ζεστό για το βράδυ.', en: 'The Aegean wind is strong — bring something warm for the evening.' },
      { el: 'Αφήστε χώρο για ό,τι θα αγοράσετε.', en: 'Leave room for what you will buy.' },
    ],
  },
];

async function seedBlog() {
  for (const a of AUTHORS) {
    await seedGroup('author', a.slug, (l) => ({
      name: pick(l, a.name),
      alternateName: l === 'el' ? a.name.en : a.name.el,
      jobTitle: pick(l, a.jobTitle),
      summary: pick(l, a.summary),
      bio: richText(pick(l, a.summary)),
    }));
  }
  const cats = await seedTerms('article_category', [
    ['travel', { el: 'Ταξίδια', en: 'Travel' }],
    ['food', { el: 'Γεύσεις', en: 'Food' }],
    ['makers', { el: 'Δημιουργοί', en: 'Makers' }],
  ]);
  const authorId: Record<string, Record<string, number>> = {};
  for (const a of AUTHORS) {
    authorId[a.slug] = {};
    for (const l of LOCALES) authorId[a.slug][l] = await idOf('author', a.slug, l);
  }
  for (const a of ARTICLES) {
    await seedGroup('article', a.slug, (l) => ({
      title: pick(l, a.title),
      excerpt: pick(l, a.excerpt),
      body: richText(...a.body.map((b) => pick(l, b))),
      author: authorId[a.author][l],
      categories: [cats[a.category]],
    }));
  }
}

// ── FAQ ─────────────────────────────────────────────────────────────────────

const FAQS: Array<{ slug: string; category: string; question: L; answer: L }> = [
  {
    slug: 'how-long-does-delivery-take',
    category: 'orders',
    question: { el: 'Πόσο χρόνο παίρνει η αποστολή;', en: 'How long does delivery take?' },
    answer: { el: '1–3 εργάσιμες ημέρες σε όλη την Ελλάδα.', en: '1–3 working days anywhere in Greece.' },
  },
  {
    slug: 'is-shipping-free',
    category: 'orders',
    question: { el: 'Υπάρχει δωρεάν αποστολή;', en: 'Is shipping free?' },
    answer: { el: 'Ναι, για παραγγελίες άνω των 60 €.', en: 'Yes, on orders over €60.' },
  },
  {
    slug: 'can-i-return-an-item',
    category: 'orders',
    question: { el: 'Μπορώ να επιστρέψω ένα προϊόν;', en: 'Can I return an item?' },
    answer: { el: 'Μέσα σε 14 ημέρες από την παραλαβή, αχρησιμοποίητο.', en: 'Within 14 days of delivery, unused.' },
  },
  {
    slug: 'how-do-i-pay',
    category: 'orders',
    question: { el: 'Πώς πληρώνω;', en: 'How do I pay?' },
    answer: { el: 'Με τραπεζική μεταφορά ή αντικαταβολή.', en: 'By bank transfer or cash on delivery.' },
  },
  {
    slug: 'how-does-booking-work',
    category: 'stays',
    question: { el: 'Πώς γίνεται η κράτηση;', en: 'How does booking work?' },
    answer: {
      el: 'Στέλνετε αίτημα, το επιβεβαιώνουμε και σας στέλνουμε σύνδεσμο για την προκαταβολή.',
      en: 'You send a request, we confirm it and send you a link to pay the deposit.',
    },
  },
  {
    slug: 'how-much-is-the-deposit',
    category: 'stays',
    question: { el: 'Πόση είναι η προκαταβολή;', en: 'How much is the deposit?' },
    answer: { el: '30% της συνολικής τιμής· το υπόλοιπο πριν την άφιξη.', en: '30% of the total; the rest before arrival.' },
  },
  {
    slug: 'can-i-cancel-my-stay',
    category: 'stays',
    question: { el: 'Μπορώ να ακυρώσω;', en: 'Can I cancel my stay?' },
    answer: { el: 'Δωρεάν έως 14 ημέρες πριν την άφιξη.', en: 'Free of charge up to 14 days before arrival.' },
  },
  {
    slug: 'do-you-speak-english',
    category: 'general',
    question: { el: 'Μιλάτε αγγλικά;', en: 'Do you speak English?' },
    answer: { el: 'Ναι, απαντάμε σε ελληνικά και αγγλικά.', en: 'Yes, we answer in Greek and English.' },
  },
];

async function seedFaq() {
  const cats = await seedTerms('answer_category', [
    ['orders', { el: 'Παραγγελίες', en: 'Orders' }],
    ['stays', { el: 'Διαμονή', en: 'Stays' }],
    ['general', { el: 'Γενικά', en: 'General' }],
  ]);
  for (const q of FAQS) {
    await seedGroup('answer', q.slug, (l) => ({
      question: pick(l, q.question),
      shortAnswer: pick(l, q.answer),
      body: richText(pick(l, q.answer)),
      categories: [cats[q.category]],
    }));
  }
}

// ── Case studies ────────────────────────────────────────────────────────────

const CASES: Array<{ slug: string; category: string; industry: L; title: L; summary: L; body: [L, L] }> = [
  {
    slug: 'hotel-group-direct-bookings',
    category: 'hospitality',
    industry: { el: 'Φιλοξενία', en: 'Hospitality' },
    title: { el: 'Διπλάσιες απευθείας κρατήσεις για ξενοδοχειακό όμιλο', en: 'Twice the direct bookings for a hotel group' },
    summary: { el: 'Από τις πλατφόρμες στο δικό τους site.', en: 'From booking platforms to their own site.' },
    body: [
      { el: 'Ο όμιλος πλήρωνε 18% προμήθεια σε κάθε κράτηση.', en: 'The group paid 18% commission on every booking.' },
      { el: 'Σε μία σεζόν, οι απευθείας κρατήσεις διπλασιάστηκαν.', en: 'In one season, direct bookings doubled.' },
    ],
  },
  {
    slug: 'villa-owner-season-in-six-weeks',
    category: 'hospitality',
    industry: { el: 'Ενοικιαζόμενες βίλες', en: 'Villa rentals' },
    title: { el: 'Γεμάτη σεζόν σε έξι εβδομάδες', en: 'A full season in six weeks' },
    summary: { el: 'Τέσσερις βίλες, ένα ημερολόγιο.', en: 'Four villas, one calendar.' },
    body: [
      { el: 'Εποχικές τιμές και κανόνες Σαββάτου-Σαββάτου.', en: 'Seasonal rates and Saturday-to-Saturday rules.' },
      { el: 'Όλες οι εβδομάδες του Αυγούστου κλείστηκαν μέχρι τον Μάρτιο.', en: 'Every August week was booked by March.' },
    ],
  },
  {
    slug: 'olive-oil-producer-goes-online',
    category: 'retail',
    industry: { el: 'Τρόφιμα', en: 'Food & drink' },
    title: { el: 'Παραγωγός ελαιολάδου πουλά online', en: 'An olive oil producer goes online' },
    summary: { el: 'Από τη λαϊκή σε όλη την Ευρώπη.', en: 'From the farmers’ market to all of Europe.' },
    body: [
      { el: 'Ένα απλό κατάστημα με τρία προϊόντα.', en: 'A simple shop with three products.' },
      { el: '400 παραγγελίες τον πρώτο χρόνο.', en: '400 orders in the first year.' },
    ],
  },
  {
    slug: 'ceramics-studio-wholesale',
    category: 'retail',
    industry: { el: 'Χειροτεχνία', en: 'Crafts' },
    title: { el: 'Εργαστήριο κεραμικής με χονδρική', en: 'A ceramics studio adds wholesale' },
    summary: { el: 'Παραλλαγές, απόθεμα και καταστήματα-συνεργάτες.', en: 'Variations, stock and partner shops.' },
    body: [
      { el: 'Κάθε χρώμα και μέγεθος με δικό του απόθεμα.', en: 'Each colour and size with its own stock.' },
      { el: 'Οι παραγγελίες χονδρικής πλέον έρχονται online.', en: 'Wholesale orders now come in online.' },
    ],
  },
];

async function seedCases() {
  const cats = await seedTerms('scenario_category', [
    ['hospitality', { el: 'Φιλοξενία', en: 'Hospitality' }],
    ['retail', { el: 'Λιανική', en: 'Retail' }],
  ]);
  for (const c of CASES) {
    await seedGroup('scenario', c.slug, (l) => ({
      title: pick(l, c.title),
      industry: pick(l, c.industry),
      summary: pick(l, c.summary),
      body: richText(...c.body.map((b) => pick(l, b))),
      categories: [cats[c.category]],
    }));
  }
}

/** `db:seed-site`'s placeholders, moved back to draft so the demo shows only demo content. */
const PLACEHOLDERS: Array<[string, string]> = [
  ['product', 'sample-product'],
  ['category', 'sample-category'],
  ['booking', 'sample-experience'],
  ['booking_category', 'sample'],
  ['vessel_type', 'sample'],
  ['departure_location', 'sample'],
  ['article', 'hello-world'],
  ['author', 'sample-author'],
  ['answer', 'sample-question'],
  ['scenario', 'sample-case-study'],
];

async function hidePlaceholders() {
  const db = getDb();
  let n = 0;
  for (const [type, slug] of PLACEHOLDERS) {
    const rows = await db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(and(eq(schema.documents.type, type), eq(schema.documents.slug, slug), eq(schema.documents.status, 'published')));
    if (rows.length === 0) continue;
    await db
      .update(schema.documents)
      .set({ status: 'draft' })
      .where(inArray(schema.documents.id, rows.map((r) => r.id)));
    n += rows.length;
  }
  console.log(`✓ ${n} placeholder documents moved to draft`);
}

async function main(): Promise<void> {
  await seedShop();
  await seedShipping();
  await seedStays();
  await seedBlog();
  await seedFaq();
  await seedCases();
  await hidePlaceholders();
  console.log(formatSeedSummary('Demo content (published)', counts, mode));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
