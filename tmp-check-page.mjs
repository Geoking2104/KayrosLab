const base = 'https://www.kayroslab.com/salon/';
(async () => {
  const page = await fetch(base);
  const html = await page.text();
  console.log('page', page.status, '| share:', html.includes('id="share"'), '| v7:', html.includes('v=7'));
  const app = await fetch(base + 'app.js');
  const js = await app.text();
  console.log('app.js', app.status, '| refreshRoom:', js.includes('refreshRoom'), '| shareRoom:', js.includes('shareRoom'), '| SHARED_ID:', js.includes('SHARED_ID'), '| applyRemoteRoom:', js.includes('applyRemoteRoom'));
  const css = await fetch(base + 'style.css');
  console.log('style.css', css.status);
})();
