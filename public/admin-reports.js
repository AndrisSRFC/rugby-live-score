const reportsLink=document.createElement('link');reportsLink.rel='stylesheet';reportsLink.href='/admin-reports.css';document.head.append(reportsLink);
const reportsButtons=document.createElement('span');reportsButtons.className='row admin-report-controls';
reportsButtons.innerHTML='<button type="button" id="openMatchReport">MATCH REPORT</button><button type="button" id="openPlayerStats">PLAYER STATS</button>';
squadPanel.querySelector('.row').append(reportsButtons);
const reportDialog=document.createElement('dialog');reportDialog.id='matchReportDialog';reportDialog.className='admin-report-dialog';
reportDialog.innerHTML='<div class="report-screen"><header><button type="button" id="reportBack">← BACK TO ADMIN</button><h2>Rugby LIVE — Match Report</h2></header><div class="report-tools"><label>Match<select id="reportMatchSelect"></select></label><button type="button" id="reportSave">Save Report &amp; Stats</button><button type="button" id="reportPrint">Print / Save as PDF</button><button type="button" id="reportCopy">Copy Summary</button></div><p id="reportMessage" role="status"></p><div id="reportEditor"></div></div><div id="reportPrintContent"></div>';
document.body.append(reportDialog);
const playerDialog=document.createElement('dialog');playerDialog.id='playerProfileDialog';playerDialog.className='admin-report-dialog';
playerDialog.innerHTML='<header><button type="button" id="profileBack">← BACK TO ADMIN</button><h2>Player Statistics</h2></header><label class="report-tools">Player<select id="profilePlayerSelect"></select></label><p id="profileMessage" role="status"></p><div id="profileContent"></div>';
document.body.append(playerDialog);
let reportDraft=null,reportTeam=null,reportDirty=false,reportSerial=0,profileSerial=0,reportSaving=false;
const reportDate=value=>new Date(value).toLocaleDateString('en-GB');
function reportNode(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
async function reportRequest(path,body={}){const r=await fetch('/api/admin-reports/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,pin:$('pin').value})});const data=await r.json();if(!r.ok)throw new Error(data.error || 'Could not load report');return data;}
function reportStatus(text){$('reportMessage').textContent=text;}
function readReport(){
  return {matchId:reportDraft.match.id,team:reportTeam,description:$('coachDescription').value,players:[...$('reportPlayerRows').children].map(row=>({id:row.dataset.playerId,played:row.querySelector('[data-played]').checked,tries:Number(row.querySelector('[data-tries]').value),conversions:Number(row.querySelector('[data-conversions]').value)}))};
}
function addReportRow(player){
  const row=reportNode('tr');row.dataset.playerId=player.id;
  const name=reportNode('td');const link=reportNode('button',player.name,'report-player-link');link.type='button';link.addEventListener('click',()=>openPlayerProfile(player.id));name.append(link);row.append(name);
  const playedCell=reportNode('td');const played=reportNode('input');played.type='checkbox';played.checked=!!player.played;played.dataset.played='';played.setAttribute('aria-label',player.name+' played');playedCell.append(played);row.append(playedCell);
  for(const key of ['tries','conversions']){const td=reportNode('td'),input=reportNode('input');input.type='number';input.min='0';input.max='100';input.step='1';input.value=String(player[key] || 0);input.dataset[key]='';input.setAttribute('aria-label',player.name+' '+key);input.addEventListener('input',()=>{if(Number(input.value)>0)played.checked=true;});td.append(input);row.append(td);}
  row.addEventListener('input',()=>{reportDirty=true;reportStatus('Unsaved changes');});$('reportPlayerRows').append(row);
}
function drawReport(data){
  reportDraft=data;reportDirty=false;
  const match=data.match,box=$('reportEditor');box.replaceChildren();
  box.append(reportNode('h3',match.home_name+' '+match.home_score+' – '+match.away_score+' '+match.away_name),reportNode('p',reportDate(match.played_at)+' · '+match.team_key+' · '+(match.season_id || 'Season not recorded')+' · '+match.match_type+' · '+match.status,'report-muted'));
  box.append(reportNode('p','Mark Played only for players who took the field. Career totals use confirmed results.','report-muted'));
  const scroll=reportNode('div',undefined,'report-table-wrap'),table=reportNode('table');const head=reportNode('thead'),hr=reportNode('tr');['Player','Played','Tries','Conversions'].forEach(t=>hr.append(reportNode('th',t)));head.append(hr);const body=reportNode('tbody');body.id='reportPlayerRows';table.append(head,body);scroll.append(table);box.append(scroll);data.players.forEach(addReportRow);
  const row=reportNode('div',undefined,'report-tools');const select=reportNode('select');select.id='reportAddPlayer';select.setAttribute('aria-label','Add player to report');select.append(new Option('Select an additional player',''));data.roster.filter(p=>!data.players.some(s=>s.id===p.id)).forEach(p=>select.append(new Option(p.name,p.id)));
  const add=reportNode('button','Add Player');add.type='button';add.addEventListener('click',()=>{const player=data.roster.find(p=>p.id===select.value);if(!player)return;if([...body.children].some(r=>r.dataset.playerId===player.id))return;addReportRow({...player,played:false,tries:0,conversions:0});select.selectedOptions[0].remove();select.value='';reportDirty=true;reportStatus('Unsaved changes');});row.append(select,add);box.append(row);
  const label=reportNode('label','Coach’s Match Report');label.htmlFor='coachDescription';const description=reportNode('textarea');description.id='coachDescription';description.maxLength=20000;description.rows=8;description.value=data.description;description.addEventListener('input',()=>{reportDirty=true;reportStatus('Unsaved changes');});box.append(label,description);
  reportStatus(data.players.length?'Report loaded':'No saved squad for this match. Add players to record their statistics.');
}
async function loadAdminReport(){
  const id=Number($('reportMatchSelect').value);if(!id)return;
  if(reportDirty&&!confirm('Discard unsaved report changes?')){$('reportMatchSelect').value=String(reportDraft.match.id);return;}
  const serial=++reportSerial;reportDraft=null;reportStatus('Loading…');$('reportEditor').replaceChildren();
  try{const data=await reportRequest('report',{matchId:id,team:reportTeam});if(serial===reportSerial&&reportDialog.open)drawReport(data);}catch(e){reportStatus(e.message);}
}
$('openMatchReport').addEventListener('click',async()=>{
  if(!matchMedia('(min-width:721px)').matches)return;
  reportTeam=selectedTeam;reportDirty=false;reportDraft=null;reportStatus('Loading matches…');$('reportEditor').replaceChildren();$('reportMatchSelect').replaceChildren();reportDialog.showModal();
  try{const matches=await reportRequest('matches',{team:reportTeam});if(!reportDialog.open)return;for(const m of matches)$('reportMatchSelect').append(new Option(reportDate(m.played_at)+' · '+m.home_name+' '+m.home_score+'–'+m.away_score+' '+m.away_name+' · '+m.status,m.id));if(matches.length)await loadAdminReport();else reportStatus('No completed matches for this age group. End a match first.');}catch(e){reportStatus(e.message);}
});
$('reportMatchSelect').addEventListener('change',loadAdminReport);
function closeReport(){if(reportSaving)return;if(reportDirty&&!confirm('Discard unsaved report changes?'))return;reportDialog.close();reportSerial++;}
$('reportBack').addEventListener('click',closeReport);reportDialog.addEventListener('cancel',e=>{e.preventDefault();closeReport();});
$('reportSave').addEventListener('click',async()=>{if(!reportDraft || reportSaving)return;const draft=reportDraft;reportSaving=true;$('reportSave').disabled=true;$('reportMatchSelect').disabled=true;try{await reportRequest('save',readReport());if(reportDraft===draft){reportDirty=false;reportStatus('Saved. Confirmed match statistics are included in season and career totals.');}}catch(e){reportStatus(e.message);}finally{reportSaving=false;$('reportSave').disabled=false;$('reportMatchSelect').disabled=false;}});
function reportSummary(){const data=readReport(),m=reportDraft.match;const lines=['Rugby LIVE — Match Report',m.home_name+' '+m.home_score+' – '+m.away_score+' '+m.away_name,reportDate(m.played_at)+' | '+m.team_key+' | '+m.season_id+' | '+m.status,reportDirty?'Unsaved draft':'Saved report','','PLAYER STATISTICS'];for(const p of data.players){const name=$('reportPlayerRows').querySelector('[data-player-id="'+p.id+'"]').querySelector('button').textContent;lines.push(name+' | '+(p.played?'Played':'Did not play')+' | Tries: '+p.tries+' | Conversions: '+p.conversions);}lines.push('','COACH’S MATCH REPORT',data.description);return lines.join('\n');}
$('reportCopy').addEventListener('click',async()=>{if(!reportDraft)return;try{await navigator.clipboard.writeText(reportSummary());reportStatus('Summary copied.');}catch(e){reportStatus('Clipboard unavailable. Use Print / Save as PDF.');}});
$('reportPrint').addEventListener('click',()=>{if(!reportDraft)return;const box=$('reportPrintContent');box.replaceChildren();const logo=reportNode('img');logo.src='/age-group-live-icon.png';logo.alt='Rugby LIVE';logo.width=64;logo.height=64;box.append(logo,reportNode('h1','Rugby LIVE'),reportNode('pre',reportSummary()));window.print();});
async function openPlayerProfile(playerId){
  if(!matchMedia('(min-width:721px)').matches)return;
  $('profileBack').textContent=reportDialog.open?'← BACK TO MATCH REPORT':'← BACK TO ADMIN';
  profileSerial++;$('profileContent').replaceChildren();$('profileMessage').textContent='Loading players…';if(!playerDialog.open)playerDialog.showModal();
  try{const players=await reportRequest('players');if(!playerDialog.open)return;const select=$('profilePlayerSelect');select.replaceChildren();for(const p of players)select.append(new Option(p.name+' · '+p.team_key+(p.active?'':' · archived'),p.id));if(playerId)select.value=playerId;if(select.value)await loadPlayerProfile();else $('profileMessage').textContent='No players saved yet.';}catch(e){$('profileMessage').textContent=e.message;}
}
async function loadPlayerProfile(){
  const serial=++profileSerial;$('profileContent').replaceChildren();$('profileMessage').textContent='Loading statistics…';
  try{const data=await reportRequest('profile',{playerId:$('profilePlayerSelect').value});if(serial!==profileSerial||!playerDialog.open)return;const box=$('profileContent');box.replaceChildren();box.append(reportNode('h2',data.player.name),reportNode('p',data.player.team_key+(data.player.active?'':' · archived'),'report-muted'));
    if(!data.player.active){
      const remove=reportNode('button','Delete from List');remove.type='button';
      remove.addEventListener('click',async()=>{
        if(!confirm('Remove '+data.player.name+' from the Player Statistics list? Previous match records will be kept.'))return;
        remove.disabled=true;
        try{await reportRequest('hide-player',{playerId:data.player.id});await openPlayerProfile();}
        catch(e){$('profileMessage').textContent=e.message;remove.disabled=false;}
      });
      box.append(remove);
    }
    const current=data.seasons.filter(s=>s.season===data.currentSeason).reduce((a,s)=>({appearances:a.appearances+s.appearances,tries:a.tries+s.tries,conversions:a.conversions+s.conversions}),{appearances:0,tries:0,conversions:0});
    const tiles=reportNode('div',undefined,'report-stats');for(const [label,stats] of [['THIS SEASON · '+data.currentSeason,current],['CAREER TOTAL',data.totals]]){const tile=reportNode('section');tile.append(reportNode('h3',label),reportNode('p',stats.appearances+' games · '+stats.tries+' tries · '+stats.conversions+' conversions'));tiles.append(tile);}box.append(tiles,reportNode('p','Only confirmed matches with recorded player statistics are counted.','report-muted'));
    const seasons=reportNode('select');seasons.setAttribute('aria-label','Statistics season');seasons.append(new Option('All seasons',''));[...new Set(data.seasons.map(s=>s.season))].forEach(s=>seasons.append(new Option(s || 'Unspecified',s || '')));box.append(seasons);const details=reportNode('div');box.append(details);
    function draw(){details.replaceChildren();const table=reportNode('table'),head=reportNode('tr');['Season','Group','Games','Tries','Conversions'].forEach(h=>head.append(reportNode('th',h)));table.append(head);for(const s of data.seasons.filter(s=>!seasons.value||s.season===seasons.value)){const row=reportNode('tr');[s.season,s.team,s.appearances,s.tries,s.conversions].forEach(v=>row.append(reportNode('td',v)));table.append(row);}details.append(table,reportNode('h3','MATCH HISTORY'));const matches=data.matches.filter(m=>!seasons.value||m.season_id===seasons.value);if(!matches.length)details.append(reportNode('p','No recorded confirmed matches yet.'));for(const m of matches){const item=reportNode('div',undefined,'report-history-item');item.append(reportNode('strong',reportDate(m.played_at)+' · '+m.home_name+' '+m.home_score+'–'+m.away_score+' '+m.away_name),reportNode('p',m.team_key+' · '+m.season_id+' · '+(m.played?'Played':'Did not play')+' · '+m.tries+' tries · '+m.conversions+' conversions'));details.append(item);}}
    seasons.addEventListener('change',draw);draw();$('profileMessage').textContent='';
  }catch(e){$('profileMessage').textContent=e.message;}
}
$('openPlayerStats').addEventListener('click',()=>openPlayerProfile());$('profilePlayerSelect').addEventListener('change',loadPlayerProfile);$('profileBack').addEventListener('click',()=>{playerDialog.close();profileSerial++;});playerDialog.addEventListener('close',()=>{profileSerial++;});
