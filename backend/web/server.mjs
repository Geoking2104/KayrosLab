import express from 'express';
import ejs from 'ejs';
import path from 'path';
import { fileURLToPath } from 'url';
import i18n from 'i18n';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// --- i18n configuration ---
i18n.configure({
	locales: ['en', 'fr'],
	defaultLocale: 'en',
	cookie: 'lang',
	queryParameter: 'lang',
	directory: path.join(__dirname, 'locales'),
	updateFiles: false,
	syncFiles: false,
	objectNotation: true,
	autoReload: true,
});

// --- Middleware ---
app.use(i18n.init);
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/tokens.css', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', '..', 'tokens.css'));
});

// Make i18n available in all views
app.use((req, res, next) => {
	res.locals.__ = res.__.bind(res);
	res.locals.locale = req.getLocale();
	next();
});

// --- View engine ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- Routes ---
app.get('/', (req, res) => {
	res.render('homepage-studio', {
		locale: req.getLocale(),
		path: req.path,
	});
});

app.get('/index.html', (req, res) => {
	res.render('homepage-studio', {
		locale: req.getLocale(),
		path: req.path,
	});
});

app.get('/whitepaper/listen', (req, res) => {
	res.render('whitepaper-listen', {
		locale: req.getLocale(),
	});
});

app.get('/whitepaper-listen.html', (req, res) => {
	res.render('whitepaper-listen', {
		locale: req.getLocale(),
	});
});

app.get('/whitepaper/position', (req, res) => {
	res.render('whitepaper-position', {
		locale: req.getLocale(),
	});
});

app.get('/whitepaper-position.html', (req, res) => {
	res.render('whitepaper-position', {
		locale: req.getLocale(),
	});
});

app.get('/whitepaper/kayroslab', (req, res) => {
	res.render('whitepaper-kayroslab', {
		locale: req.getLocale(),
	});
});

app.get('/whitepaper-kayroslab.html', (req, res) => {
	res.render('whitepaper-kayroslab', {
		locale: req.getLocale(),
	});
});

app.get('/whitepaper-hackathon.html', (req, res) => {
	res.render('whitepaper-hackathon', {
		locale: req.getLocale(),
	});
});

// --- Serve French version at /index.fr.html (for static build compatibility) ---
app.get('/index.fr.html', (req, res) => {
	res.render('homepage-studio', { locale: 'fr' });
});

// --- Language switch redirect ---
app.get('/lang/:locale', (req, res) => {
	const locale = req.params.locale;
	if (['en', 'fr'].includes(locale)) {
		res.cookie('lang', locale, { maxAge: 365 * 24 * 60 * 60 * 1000 });
		res.setLocale(locale);
	}
	res.redirect(req.get('Referrer') || '/');
});

app.listen(PORT, () => {
	console.log(`KayrosLab website running at http://localhost:${PORT}`);
	console.log(`  EN: http://localhost:${PORT}/`);
	console.log(`  FR: http://localhost:${PORT}/?lang=fr`);
});
