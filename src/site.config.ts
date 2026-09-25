/**
 * Demo Site — the site's CMS configuration.
 *
 * This one file drives the admin (collections, fields, labels), validation and
 * typed reads. It is SITE code: it imports the core, never the reverse.
 *
 * Commerce and booking collections are always registered; whether they are live
 * is the module flag (defaults here, overridden in Admin → Settings → Modules).
 * A module that is off hides its collections in the admin and 404s its routes,
 * so switching one on later is a setting, not a code change.
 */
import { defineCollection, defineConfig, f, taxonomyCollection } from '@/cms/config';
import { brandCollection } from '@/cms/core/content/brand';
import { testimonialCollection } from '@/cms/core/content/testimonial';
import { popupCollection } from '@/cms/modules/popups';
import { bookingCollection, bookingFieldResolver, bookingTermCollection } from '@/cms/modules/booking';
import { categoryCollection, productCollection, sizeChartCollection, tagCollection } from '@/cms/modules/commerce';
import { STORAGE_PREFIX } from '@/lib/storage-keys';
import { brand } from '@/site.brand';

/** Standalone pages at `/{slug}`: home copy (slug `home`), about, legal pages, … */
const page = defineCollection({
  key: 'page',
  label: 'Page',
  labelPlural: 'Pages',
  icon: 'file-text',
  routing: { pathTemplate: '/{slug}' },
  fields: [
    f.text('title', {
      required: true,
      maxLength: 255,
      label: 'Title',
      description: 'The heading at the top of the page. Search engines show it too, unless you set an SEO title.',
    }),
    f.richText('body', {
      label: 'Content',
      description: 'The main text of the page. “+ Block” in the toolbar adds things like reviews or a countdown.',
    }),
    f.image('hero', { label: 'Hero image', description: 'The large image at the top of the page. Optional.' }),
  ],
});

const author = defineCollection({
  key: 'author',
  label: 'Author',
  labelPlural: 'Authors',
  icon: 'user-pen',
  // The profile page is what `Person.url` points at: one page on this site that
  // says who wrote the articles.
  routing: { pathTemplate: '/authors/{slug}' },
  fields: [
    f.text('name', {
      required: true,
      maxLength: 191,
      label: 'Full name',
      description: 'The heading of the profile page, and the byline on every article they wrote.',
    }),
    f.text('alternateName', {
      maxLength: 191,
      label: 'Other spelling',
      description: 'The name in the other alphabet. Links the two spellings to one person.',
    }),
    f.text('jobTitle', { maxLength: 191, label: 'Job title', description: 'Shown under the name.' }),
    f.textarea('summary', {
      label: 'Summary',
      description: 'One or two plain sentences on who this is. Shown at the top of the page.',
    }),
    f.richText('bio', { label: 'Biography', description: 'The longer story, shown on the profile page below the summary.' }),
    f.image('avatar', { label: 'Photo', description: 'Square works best.' }),
    f.text('linkedinUrl', {
      maxLength: 512,
      pattern: '^$|^https?://',
      label: 'LinkedIn URL',
      description: 'Full address, starting with https://',
    }),
    f.repeater(
      'profiles',
      [f.text('url', { required: true, maxLength: 512, pattern: '^$|^https?://', label: 'URL', description: 'Full address, starting with https://' })],
      { label: 'Other profiles', description: 'Pages about this person elsewhere.' },
    ),
    f.repeater(
      'experience',
      [
        f.text('name', { required: true, label: 'Organisation', description: 'The company, school or body, e.g. "University of Athens".' }),
        f.text('url', { maxLength: 512, pattern: '^$|^https?://', label: 'Website', description: 'Optional. Full address, starting with https://' }),
        f.text('role', { label: 'Role', description: 'What they did there, e.g. "Head chef" or "MSc Economics".' }),
        f.text('period', { label: 'Period', description: 'e.g. "2015–2020".' }),
      ],
      { label: 'Experience & education', description: 'Jobs, studies and memberships, listed on the profile page.' },
    ),
    f.repeater(
      'knowsAbout',
      [
        f.text('name', { required: true, label: 'Name', description: 'The topic, e.g. "Greek tax law".' }),
        f.text('sameAs', { label: 'Reference URL', description: 'Optional link that identifies it, usually its Wikipedia page.' }),
      ],
      { label: 'Expertise', description: 'Topics this person is an authority on.' },
    ),
  ],
});

const articleCategory = taxonomyCollection({
  key: 'article_category',
  label: 'Blog category',
  labelPlural: 'Blog categories',
  hierarchical: true,
  pathTemplate: '/blog/categories/{slug}',
});

const article = defineCollection({
  key: 'article',
  label: 'Article',
  labelPlural: 'Articles',
  icon: 'newspaper',
  routing: { pathTemplate: '/blog/{slug}', reservedSlugs: ['categories'] },
  // Unpublished, the article's URL redirects to its category (302 draft, 301 archived).
  unpublishRedirect: { taxonomyField: 'categories', fallbackPath: '/blog/categories' },
  fields: [
    f.text('title', {
      required: true,
      maxLength: 255,
      label: 'Title',
      description: 'The headline. Search engines show it too, unless you set an SEO title.',
    }),
    f.textarea('excerpt', {
      label: 'Excerpt',
      description: 'One or two sentences, shown on the blog list and in search results.',
    }),
    f.image('cover', {
      label: 'Cover image',
      description: 'The picture at the top of the article. Also used when it is shared on social media, unless SEO sets its own.',
    }),
    f.richText('body', { required: true, label: 'Body', description: 'The article itself.' }),
    f.relation('author', {
      to: 'author',
      label: 'Author',
      description: 'Who wrote it. Their name links to their profile, once that profile is published.',
    }),
    f.relation('categories', {
      label: 'Categories',
      to: 'article_category',
      many: true,
      picker: 'categoryTree',
      shared: true,
      description: 'If this is ever unpublished, its visitors are sent to the first category listed.',
    }),
  ],
});

const answerCategory = taxonomyCollection({
  key: 'answer_category',
  label: 'FAQ category',
  labelPlural: 'FAQ categories',
  hierarchical: true,
  pathTemplate: '/faq/categories/{slug}',
});

const answer = defineCollection({
  key: 'answer',
  titlePath: 'question',
  label: 'Answer',
  labelPlural: 'Answers',
  icon: 'message-circle-question',
  routing: { pathTemplate: '/faq/{slug}', reservedSlugs: ['categories'] },
  unpublishRedirect: { taxonomyField: 'categories', fallbackPath: '/faq/categories' },
  fields: [
    f.text('question', {
      required: true,
      maxLength: 255,
      label: 'Question',
      description: 'Asked the way a visitor would ask it. It is the heading of the answer page.',
    }),
    f.textarea('shortAnswer', {
      required: true,
      label: 'Short answer',
      description: 'Two or three sentences. Shown in the FAQ list and given to search engines as the answer.',
    }),
    f.richText('body', { label: 'Full answer', description: 'Optional detail below the short answer.' }),
    f.relation('categories', {
      label: 'Categories',
      to: 'answer_category',
      many: true,
      picker: 'categoryTree',
      shared: true,
      description: 'If this is ever unpublished, its visitors are sent to the first category listed.',
    }),
  ],
});

const scenarioCategory = taxonomyCollection({
  key: 'scenario_category',
  label: 'Case study category',
  labelPlural: 'Case study categories',
  hierarchical: true,
  pathTemplate: '/case-studies/categories/{slug}',
});

const scenario = defineCollection({
  key: 'scenario',
  label: 'Case study',
  labelPlural: 'Case studies',
  icon: 'briefcase',
  routing: { pathTemplate: '/case-studies/{slug}', reservedSlugs: ['categories'] },
  unpublishRedirect: { taxonomyField: 'categories', fallbackPath: '/case-studies/categories' },
  fields: [
    f.text('title', {
      required: true,
      maxLength: 255,
      label: 'Title',
      description: 'The headline. Search engines show it too, unless you set an SEO title.',
    }),
    f.text('industry', { maxLength: 120, label: 'Industry', description: 'Shown above the title, e.g. "Hospitality".' }),
    f.textarea('summary', { label: 'Summary', description: 'One or two sentences for the list page.' }),
    f.image('cover', {
      label: 'Cover image',
      description: 'The picture at the top of the case study. Also used when it is shared on social media, unless SEO sets its own.',
    }),
    f.richText('body', { required: true, label: 'Body', description: 'The case study itself.' }),
    f.relation('categories', {
      label: 'Categories',
      to: 'scenario_category',
      many: true,
      picker: 'categoryTree',
      shared: true,
      description: 'If this is ever unpublished, its visitors are sent to the first category listed.',
    }),
  ],
});

const config = defineConfig({
  name: brand.name,
  // Defaults only: the live brand is edited in Admin → Settings → Branding.
  brand,
  locales: ['el', 'en'],
  defaultLocale: 'el',
  storagePrefix: STORAGE_PREFIX,
  productionOrigin: brand.url,
  modules: {
    commerce: true,
    booking: true,
    forms: true,
    seo: true,
    newsletter: true,
    // Shop accounts: register at checkout, order history, saved addresses.
    // Needs commerce; on its own it has nothing to show.
    customers: true,
    // Google reviews + testimonials, placed with [google-reviews] / [testimonials].
    googleReviews: false,
    // Popups over the page, targeted per path.
    popups: false,
    media: true,
    pm: false,
  },
  collections: [
    page,
    // Logos for the [brands] shortcode. Edited under Content; no pages of their own.
    brandCollection(),
    // Quotes the owner enters; Google's own reviews are synced, not authored.
    testimonialCollection(),
    // Popups — live only while the popups module is on.
    popupCollection(),
    author,
    articleCategory,
    article,
    answerCategory,
    answer,
    scenarioCategory,
    scenario,
    // Commerce — live only while the commerce module is on.
    categoryCollection(),
    sizeChartCollection(),
    tagCollection(),
    productCollection(),
    // Booking — live only while the booking module is on. The three term
    // collections are the /booking filters; their keys are fixed, their labels
    // follow what this site sells.
    bookingTermCollection({
      key: 'booking_category',
      label: 'Category',
      labelPlural: 'Categories',
      icon: 'folder-tree',
      hierarchical: true,
    }),
    bookingTermCollection({
      key: 'vessel_type',
      label: 'Property type',
      labelPlural: 'Property types',
      icon: 'tag',
    }),
    bookingTermCollection({
      key: 'departure_location',
      label: 'Location',
      labelPlural: 'Locations',
      icon: 'map-pin',
    }),
    bookingCollection(),
  ],
  // Asks an experience which kind it is only when the site sells more than one.
  fieldResolvers: { booking: bookingFieldResolver },
});

export default config;
