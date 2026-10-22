import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const robots = readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8');
const sitemap = readFileSync(new URL('../public/sitemap.xml', import.meta.url), 'utf8');
const canonicalUrl = 'https://resource-pack-updater.vercel.app/';

function metaContent(attribute: string, name: string): string | undefined {
	return html.match(new RegExp(`<meta\\s+${attribute}="${name}"\\s+content="([^"]+)"\\s*/?>`))?.[1];
}

describe('search metadata', () => {
	it('includes the product and purpose in the static title and description', () => {
		expect(html).toContain(
			'<title>Minecraft Resource Pack Updater | Online Texture Pack Converter</title>',
		);
		expect(metaContent('name', 'description')).toBe(
			'Convert Minecraft Java 1.7 and 1.8 resource packs to newer versions online. Update texture packs in your browser without uploading your files.',
		);
		expect(metaContent('name', 'robots') ?? '').not.toContain('noindex');
		expect(metaContent('name', 'googlebot') ?? '').not.toContain('noindex');
	});

	it('uses the same production URL for canonical and sharing metadata', () => {
		expect(html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/g)).toHaveLength(1);
		expect(html).toContain(`<link rel="canonical" href="${canonicalUrl}" />`);
		expect(metaContent('property', 'og:url')).toBe(canonicalUrl);
		expect(metaContent('property', 'og:title')).toBe(metaContent('name', 'twitter:title'));
		expect(metaContent('property', 'og:description')).toBe(metaContent('name', 'description'));
		expect(metaContent('name', 'twitter:description')).toBe(metaContent('name', 'description'));
	});

	it('provides valid site-name structured data without invented ratings', () => {
		const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
		expect(match).not.toBeNull();
		expect(JSON.parse(match![1])).toEqual({
			'@context': 'https://schema.org',
			'@type': 'WebSite',
			name: 'Minecraft Resource Pack Updater',
			alternateName: 'Resource Pack Updater',
			url: canonicalUrl,
		});
	});

	it('allows crawling and advertises a sitemap containing only the canonical page', () => {
		expect(robots).toMatch(/^User-agent: \*\r?\nAllow: \/\r?\n/m);
		expect(robots).not.toMatch(/^Disallow:\s*\/\s*$/m);
		expect(robots).toContain(`Sitemap: ${canonicalUrl}sitemap.xml`);
		expect(sitemap).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
		expect([...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1])).toEqual([
			canonicalUrl,
		]);
	});
});
