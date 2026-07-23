import ejs from 'ejs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import i18n from 'i18n';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

i18n.configure({
	locales: ['en', 'fr'],
	defaultLocale: 'en',
	directory: path.join(__dirname, 'locales'),
	updateFiles: false,
	syncFiles: false,
	objectNotation: true,
});

const viewsDir = path.join(__dirname, 'views');
const outputDir = path.resolve(__dirname, '..', '..'); // output to repo root

async function renderTemplate(templateName, locale) {
	const templatePath = path.join(viewsDir, templateName + '.ejs');
	const template = fs.readFileSync(templatePath, 'utf-8');
	
	// Set locale for i18n
	i18n.setLocale(locale);
	
	const html = ejs.render(template, {
		__: (key, ...args) => {
			const val = i18n.__(key);
			if (args.length > 0) {
				return val.replace(/%s/g, () => args.shift());
			}
			return val;
		},
		locale: locale,
		locals: { __: i18n.__ },
		path: '/',
		new: Date,
	});
	
	return html;
}

async function build() {
	console.log('Building static HTML files...');
	
	// Build EN version → index.html (default)
	const enIndex = await renderTemplate('index', 'en');
	const indexOutput = path.join(outputDir, 'index.html');
	fs.writeFileSync(indexOutput, enIndex, 'utf-8');
	console.log(`  ✓ index.html (EN) — ${enIndex.length} bytes`);
	
	// Build FR version → index.fr.html
	const frIndex = await renderTemplate('index', 'fr');
	const frOutput = path.join(outputDir, 'index.fr.html');
	fs.writeFileSync(frOutput, frIndex, 'utf-8');
	console.log(`  ✓ index.fr.html (FR) — ${frIndex.length} bytes`);
	
	// Build whitepapers (EN)
	const wpListen = await renderTemplate('whitepaper-listen', 'en');
	fs.writeFileSync(path.join(outputDir, 'whitepaper-listen.html'), wpListen, 'utf-8');
	console.log(`  ✓ whitepaper-listen.html (EN) — ${wpListen.length} bytes`);
	
	const wpPosition = await renderTemplate('whitepaper-position', 'en');
	fs.writeFileSync(path.join(outputDir, 'whitepaper-position.html'), wpPosition, 'utf-8');
	console.log(`  ✓ whitepaper-position.html (EN) — ${wpPosition.length} bytes`);
	
	const wpKayros = await renderTemplate('whitepaper-kayroslab', 'en');
	fs.writeFileSync(path.join(outputDir, 'whitepaper-kayroslab.html'), wpKayros, 'utf-8');
	console.log(`  ✓ whitepaper-kayroslab.html (EN) — ${wpKayros.length} bytes`);

	const wpHackathon = await renderTemplate('whitepaper-hackathon', 'en');
	fs.writeFileSync(path.join(outputDir, 'whitepaper-hackathon.html'), wpHackathon, 'utf-8');
	console.log(`  ✓ whitepaper-hackathon.html (EN) — ${wpHackathon.length} bytes`);

	const frHackathon = await renderTemplate('whitepaper-hackathon', 'fr');
	fs.writeFileSync(path.join(outputDir, 'livret-blanc-hackathon.html'), frHackathon, 'utf-8');
	console.log(`  ✓ livret-blanc-hackathon.html (FR) — ${frHackathon.length} bytes`);
	
	console.log('\nDone! Static HTML files generated in repo root.');
}

build().catch(console.error);
