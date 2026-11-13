from heapq import heappush, heappop
from random import Random
from pathlib import Path
import json
r=Random(1311)
def solve(board, homes, whole=False, opening=None):
    counts={c:board.count(c) for c in set(board)-set('.#')}
    queue=[(0,board)]
    seen={board:0}
    if opening:
        cost,board=opening
        queue=[(cost,board)]
        seen={board:cost}
    while queue:
        cost,s=heappop(queue)
        if cost!=seen[s]: continue
        if all(c*n in s[slice(*homes.get(c,(0,len(s))))] for c,n in counts.items()): return cost
        for new,price,*_ in moves(s,whole):
            total=cost+price
            if total<=9 and total<seen.get(new,10):
                seen[new]=total
                heappush(queue,(total,new))
def moves(s,whole=False):
    for i,c in enumerate(s):
        if c in '.#': continue
        j=i
        while j<len(s) and s[j]==c:
            j+=1
            split=(i>0 and s[i-1]==c) or (j<len(s) and s[j]==c)
            if split and whole: continue
            n=j-i
            for k in range(len(s)-n+1):
                if s[k:k+n]=='.'*n:
                    t=list(s)
                    t[i:j]='.'*n
                    t[k:k+n]=c*n
                    yield ''.join(t),1+split,c,k,n
groups=[[],[],[]]
seen=set()
for _ in range(12000):
    if all(len(g)>=n for g,n in zip(groups,[7,7,6])): break
    family=_%3
    if len(groups[family]) >= [7,7,6][family]: continue
    homes={}
    if family==0:
        a,b=r.choice([(2,2),(2,3),(3,3),(3,4),(4,4),(4,5)])
        gap=max(a,b)
        parts=['B'*b,'A'*a,'.'*gap,'.']
        if r.randrange(2): parts+=['.']
        r.shuffle(parts)
        s='#'.join(parts)
        homes={'A':(s.index('B'),s.index('B')+a),'B':(s.index('A'),s.index('A')+b)}
        if a!=b:
            # Reserve full home stretches by using equal-sized swapped runs.
            continue
    else:
        letters='AABB'+r.choice(['AB','AAB','ABB','CC','ABCC'])
        tiles=list(letters+'.'*2)
        if family==2: tiles=list(r.choice(['AA.AACCBCB.B','AA.AACCBCB.B','AA.AABB.BBCC.','AA.AAB.BBCCC'])); x,y=r.sample(range(len(tiles)),2); tiles[x],tiles[y]=tiles[y],tiles[x]
        if family==1: r.shuffle(tiles)
        s=''.join(tiles)
        if family==1:
            a=s.count('A'); b=s.count('B')
            x=r.randrange(len(s)-a+1); y=r.randrange(len(s)-b+1)
            if not(x+a<=y or y+b<=x): continue
            homes={'A':(x,x+a),'B':(y,y+b)}
        elif r.randrange(3)==0:
            pos=r.randrange(1,len(s))
            s=s[:pos]+'#'+s[pos:]
    key=min(str((s,homes)),str((s[::-1],{c:(len(s)-y,len(s)-x) for c,(x,y) in homes.items()})))
    if key in seen: continue
    par=solve(s,homes)
    if par is None or par<3: continue
    if family==1:
        traps=[]
        for t,cost,c,k,n in moves(s,True):
            if c not in homes or c*s.count(c) not in t: continue
            x,y=homes[c]
            if c*s.count(c) in t[x:y]: continue
            end=solve(s,homes,opening=(cost,t))
            if end is not None and end>par: traps.append(end)
        if not traps: continue
    if family==2:
        whole=solve(s,homes,True)
        if whole is None or whole<=par: continue
    seen.add(key)
    # Spread disconnected stretches across the disk by widening reserved gaps.
    parts=s.split('#')
    if family==0 or len(parts)>1 or r.randrange(2):
        spare=30-len(s)
        cuts=sorted(r.randrange(spare+1) for _ in parts)
        pads=[cuts[0],*[b-a for a,b in zip(cuts,cuts[1:])],spare-cuts[-1]]
        shifts=[]
        for i,part in enumerate(parts):
            shifts.extend([sum(pads[:i+1])]*len(part))
            if i<len(parts)-1: shifts.append(sum(pads[:i+1]))
        s='#'*pads[0]+''.join(part+('#'*(1+pads[i+1]) if i+1<len(parts) else '#'*pads[-1]) for i,part in enumerate(parts))
        homes={c:(x+shifts[x],y+shifts[y-1]) for c,(x,y) in homes.items()}
    assert solve(s,homes)==par
    groups[family].append(dict(board=s,homes={c:[x+1,y] for c,(x,y) in homes.items()},par=par))
    print(family, len(groups[family]), par, flush=True)
print([len(g) for g in groups])
assert [len(g) for g in groups]==[7,7,6]
for g in groups: g.sort(key=lambda p:p['par'])
levels=[g[i] for i in range(7) for g in groups if i<len(g)]
for i,p in enumerate(levels,1):
    p.update(name=f'Board {i}',chapter='Generated playlist',goal='Join each file and finish inside any marked home.')
with open(Path(__file__).resolve().parents[1] / 'playlist.js', 'w') as out:
    out.write('const generatedPlaylist = [\n')
    for p in levels: out.write('  '+json.dumps(p, separators=(',', ': '))+',\n')
    out.write('];\n')
