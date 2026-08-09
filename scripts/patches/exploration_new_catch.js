catch(err){
    const lang=cycleLanguage();
    log((t('exploration_soft_fail',{},lang)||'soft-fail')+' '+(err.message||''), 'warn');
    const candidates=buildFallbackExplorationCandidates(roundNumber, err.message||'parse');
    demoState.explorationRounds.push({
      iteration:roundNumber,mode:mode||'challenge',feedback,
      sourceIds:(sourceCandidates||[]).map(c=>c.id),generatedAt:new Date().toISOString(),
      candidates, recovered:false, fallback:true, failReason:String(err.message||'parse')
    });
    demoState.shortlistedIdeaIds=[];
    renderIdeaCandidates();
    const host=document.getElementById('idea-candidates');
    if(host){
      const banner=document.createElement('div');
      banner.className='lg:col-span-3 rounded-2xl border border-amber-400/40 bg-amber-400/10 p-4 text-sm text-amber-50';
      banner.innerHTML='<strong>'+escapeHtml(t('exploration_soft_title',{},lang)||'Loop continues')+'</strong><br>'+escapeHtml(t('exploration_soft_body',{},lang)||'Clarification paths generated.');
      host.insertBefore(banner, host.firstChild);
    }
    document.getElementById('idea-controls').classList.remove('hidden');
  }
