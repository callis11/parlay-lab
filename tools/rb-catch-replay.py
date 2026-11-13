import pandas as pd, numpy as np, re
def load(y):
    s=pd.read_csv(f'stats_{y}.csv',low_memory=False); s=s[(s.season_type=='REG')]
    n=pd.read_csv(f'snaps_{y}.csv'); n=n[n.game_type=='REG']
    return s,n
def norm(x): return re.sub(r'[^a-z]','',str(x).lower().replace('jr','').replace('iii','').replace('ii',''))
rows=[]  # per player-game on field: season,week,team,name,pos,off_snaps,rec
for y in range(2018,2026):
    s,n=load(y)
    s=s.assign(k=s.player_display_name.map(norm))
    n=n[n.position.isin(['RB','FB'])].assign(k=lambda d:d.player.map(norm))
    st=s[['k','team','week','receptions','targets','carries']]
    m=n.merge(st,on=['k','team','week'],how='left',suffixes=('','_s'))
    m['has_stat']=m.receptions.notna()
    m['rec']=m.receptions.fillna(0)
    m['season']=y
    rows.append(m[['season','week','team','k','player','offense_snaps','offense_pct','rec','has_stat']])
    print(y,'RB snap rows',len(m),'matched stat rows',m.has_stat.mean().round(3))
d=pd.concat(rows); d=d.sort_values(['k','team','season','week']).reset_index(drop=True)
d['t']=d.season*100+d.week
out=[]
for k,g in d.groupby('k'):
    g=g.sort_values('t')
    for i,r in g.iterrows():
        if r.season==2018: continue
        if r.offense_snaps<=0: continue   # only games he actually played offense (outcome gradable)
        prior=g[g.t<r.t]
        if len(prior)<3: continue
        cur=prior[prior.season==r.season]; last=prior[prior.season==r.season-1]
        def win(df): 
            cur_=df[df.season==r.season].tail(10)
            if len(cur_)<6:
                cur_=pd.concat([df[df.season==r.season-1],cur_]).tail(10) if True else cur_
            return cur_
        # honest: all offense-played games
        P=prior[prior.offense_snaps>0]
        W_h=win(P)
        W_s=win(P[P.has_stat])  # site: only games with a stat row
        if len(W_s)<4: continue
        # role: avg snap pct last 3 on-field games vs teammates
        out.append(dict(season=r.season,week=r.week,team=r.team,k=k,snap3=P.tail(3).offense_pct.mean(),
          act1=int(r.rec>=1),act2=int(r.rec>=2),
          hs=[(W_s.rec>=1).sum(),len(W_s)],hh=[(W_h.rec>=1).sum(),len(W_h)],
          m_s=W_s.rec.mean(),m_h=W_h.rec.mean(),
          hs2=[(W_s.rec>=2).sum(),len(W_s)],hh2=[(W_h.rec>=2).sum(),len(W_h)]))
o=pd.DataFrame(out)
def emp(h): return (h[0]+1)/(h[1]+2)
for t,(a,b,mm_s,mm_h) in {'1+':('hs','hh','m_s','m_h')}.items(): pass
o['e_s']=o.hs.map(emp); o['e_h']=o.hh.map(emp)
o['f_s']=1-np.exp(-o.m_s); o['f_h']=1-np.exp(-o.m_h)
o['p_s']=.5*o.e_s+.5*o.f_s; o['p_h']=.5*o.e_h+.5*o.f_h
# team RB rank by snap3 within team-week
o['rank']=o.groupby(['season','week','team']).snap3.rank(ascending=False,method='first')
o.to_pickle('/tmp/o.pkl')
print(len(o))
def rep(df,label):
    print(f"\n{label}: n={len(df)}  actual hit {df.act1.mean():.3f}  | site-style said {df.p_s.mean():.3f} (gap {df.p_s.mean()-df.act1.mean():+.3f}) | counting no-stat games said {df.p_h.mean():.3f} (gap {df.p_h.mean()-df.act1.mean():+.3f})")
rep(o[o['rank']==1],'RB1 1+ catch')
rep(o[o['rank']==2],'RB2 1+ catch')
rep(o[o['rank']>=3],'RB3+ 1+ catch')
b=o[(o['rank']>=2)]
for lo,hi in [(.5,.65),(.65,.75),(.75,.85),(.85,1.01)]:
    x=b[(b.p_s>=lo)&(b.p_s<hi)]
    if len(x): print(f" backups site-said {lo:.2f}-{hi:.2f}: n={len(x)} said {x.p_s.mean():.3f} honest-said {x.p_h.mean():.3f} actual {x.act1.mean():.3f}")
print('\nRB2 high-rated (site>=.75) by season')
x=o[(o['rank']==2)&(o.p_s>=.75)]
print(x.groupby('season').apply(lambda g:pd.Series(dict(n=len(g),said=g.p_s.mean(),honest=g.p_h.mean(),actual=g.act1.mean()))))
# 2+ catches
for r,l in [(1,'RB1'),(2,'RB2')]:
    z=o[o['rank']==r]; print(l,'2+ catches actual',round(z.act2.mean(),3),'n',len(z))
print('\n=== BY SEASON, backups (rank>=2) 1+ catch: site-style said / honest said / actual')
b=o[o['rank']>=2]
print(b.groupby('season').apply(lambda g:pd.Series(dict(n=len(g),site=g.p_s.mean(),honest=g.p_h.mean(),actual=g.act1.mean()))).round(3))
BK=[(0.5,0.46),(0.55,0.50),(0.65,0.55),(0.75,0.63),(0.85,0.80),(0.93,0.84),(1,0.88)]
def adj(p):
    if p<=BK[0][0]: return p
    for (x0,y0),(x1,y1) in zip(BK,BK[1:]):
        if p<=x1: return y0+(y1-y0)*(p-x0)/(x1-x0)
    return BK[-1][1]
print('\n=== current table, tested on seasons it was NOT fit on (2019-2023), backups with p_h>0.5')
t=b[(b.season<=2023)&(b.p_h>0.5)]
for lo,hi in [(.5,.6),(.6,.7),(.7,.8),(.8,.9),(.9,1.01)]:
    x=t[(t.p_h>=lo)&(t.p_h<hi)]
    if len(x): print(f' said {x.p_h.mean():.3f} table gives {x.p_h.map(adj).mean():.3f} actual {x.act1.mean():.3f} n={len(x)}')
print('overall: said %.3f table %.3f actual %.3f | brier raw %.4f table %.4f'%(t.p_h.mean(),t.p_h.map(adj).mean(),t.act1.mean(),((t.p_h-t.act1)**2).mean(),((t.p_h.map(adj)-t.act1)**2).mean()))
# refit on all 2019-2025
bb=b[b.p_h>0.5]
print('\n=== refit on ALL seasons 2019-2025 (backups p>0.5), n=',len(bb))
for lo,hi in [(.5,.55),(.55,.6),(.6,.7),(.7,.8),(.8,.9),(.9,1.01)]:
    x=bb[(bb.p_h>=lo)&(bb.p_h<hi)]
    if len(x): print(f' {lo:.2f}-{hi:.2f}: n={len(x)} said {x.p_h.mean():.3f} actual {x.act1.mean():.3f} (current table {x.p_h.map(adj).mean():.3f})')
print('RB1 all seasons: said %.3f actual %.3f n=%d'%(o[o['rank']==1].p_h.mean(),o[o['rank']==1].act1.mean(),(o['rank']==1).sum()))
