"""Real PostgreSQL Phase 2 checks, inside the staging runner's rollback transaction."""
from psycopg.types.json import Jsonb

def run_phase2(c, h):
    uid, scalar, check, fail, claims = (h[k] for k in ('uid','scalar','check','fail','claims'))
    c.execute('reset role')
    c.execute('set constraints all immediate')
    c.execute(h['body'](h['sqlfile']('m3_module_passages_phase2.sql')))
    c.execute('set constraints all deferred')
    claims(c,'admin')
    fail(c,'Phase 2 legacy module-only bank writes rejected',"insert into public.comprehension_questions(module_id,question_type,question_text,options,scaffolding_hint,display_order) values(%s,'literal','Question?','[\"A\",\"B\",\"C\",\"D\"]','Read',20)",(uid(50),),state='23514')
    def load(n=50): return scalar(c,'select public.m3_admin_collection(%s)',(uid(n),))
    def save(snapshot, removed=()):
        return scalar(c,'select public.m3_save_collection(%s,%s,%s,%s,%s,%s,%s)',
          (snapshot['id'],snapshot['revision'],snapshot['title'],snapshot['learningPathId'],snapshot['difficulty'],Jsonb(snapshot['passages']),list(removed)))
    def bank(snapshot, passage, questions, action):
        return scalar(c,'select public.m3_save_passage_bank(%s,%s,%s,%s,%s)',
          (snapshot['id'],uid(passage),snapshot['revision'],Jsonb(questions),action))
    original=load()
    original['passages'][0]['passageText']='Changed only this passage'
    save(original)
    updated=load()
    check(updated['passages'][0]['passageText']=='Changed only this passage' and updated['passages'][1]['passageText']=='Reviewed text','Phase 2 edit one passage preserves another')
    fail(c,'Phase 2 stale revision rejected','select public.m3_save_collection(%s,%s,%s,%s,%s,%s,%s)',(uid(50),original['revision'],'Old',uid(10),'Easy',Jsonb(original['passages']),[]),fragment='changed')
    updated['passages'].reverse(); save(updated)
    check(load()['passages'][0]['id']==original['passages'][1]['id'],'Phase 2 atomic reorder preserves stable IDs')
    current=load(); victim=current['passages'].pop()
    fail(c,'Phase 2 omitted child cannot disappear','select public.m3_save_collection(%s,%s,%s,%s,%s,%s,%s)',(uid(50),current['revision'],'Collection',uid(10),'Easy',Jsonb(current['passages']),[]),fragment='omitted')
    save(current,[victim['id']])
    check(len(load()['passages'])==1,'Phase 2 explicit empty passage removal')
    current=load(); current['passages'].append(h['passage'](53,title='',passageText='')); save(current)
    check(load()['passages'][1]['passageText']=='','Phase 2 incomplete draft saved')
    current=load(); current['passages'].append(h['passage'](41))
    fail(c,'Phase 2 cross-module save rolls back','select public.m3_save_collection(%s,%s,%s,%s,%s,%s,%s)',(uid(50),current['revision'],'Should roll back',uid(10),'Easy',Jsonb(current['passages']),[]),fragment='another module')
    check(load()['title']=='Collection','Phase 2 failed transaction preserves parent')
    current=load()
    fail(c,'Phase 2 foreign removal ID rejected','select public.m3_save_collection(%s,%s,%s,%s,%s,%s,%s)',(uid(50),current['revision'],'Collection',uid(10),'Easy',Jsonb(current['passages']),[uid(41)]),fragment='another module')
    questions=[{'type':kind,'questionText':f'Question {i}?','options':['A','B','C','D'],'correctAnswer':'A','scaffoldingHint':'Read carefully.'}
      for i,kind in enumerate(['literal','literal','inferential','inferential','critical','critical'])]
    bank(load(),51,questions,'generate')
    current=load(); q=current['passages'][0]['questions']
    check(len(q)==6 and all(v['reviewStatus']=='generated' for v in q),'Phase 2 generation starts unreviewed')
    check(current['passages'][1]['questions']==[],'Phase 2 question-bank isolation')
    fail(c,'Phase 2 cannot remove populated passage','select public.m3_save_collection(%s,%s,%s,%s,%s,%s,%s)',(uid(50),current['revision'],'Collection',uid(10),'Easy',Jsonb([current['passages'][1]]),[uid(51)]),fragment='question bank')
    q[0]['questionText']='Edited prompt'; q[0]['correctAnswer']='B'
    bank(current,51,q,'review'); reviewed=load()
    check(reviewed['passages'][0]['questions'][0]['id']==q[0]['id'] and reviewed['passages'][0]['questions'][0]['correctAnswer']=='B','Phase 2 review atomically preserves ID and edits key')
    check(all(v['reviewStatus']=='reviewed' for v in reviewed['passages'][0]['questions']),'Phase 2 review metadata stamped')
    fail(c,'Phase 2 stale generation cannot replace reviewed bank','select public.m3_save_passage_bank(%s,%s,%s,%s,%s)',(uid(50),uid(51),current['revision'],Jsonb(questions),'generate'),fragment='changed')
    bad=[dict(v) for v in q]; bad[0]['correctAnswer']='Invalid'
    fail(c,'Phase 2 invalid key atomic rollback','select public.m3_save_passage_bank(%s,%s,%s,%s,%s)',(uid(50),uid(51),reviewed['revision'],Jsonb(bad),'review'),fragment='answer key')
    check(load()['revision']==reviewed['revision'],'Phase 2 failed bank preserves revision')
    fail(c,'Phase 2 cross-passage question IDs rejected','select public.m3_save_passage_bank(%s,%s,%s,%s,%s)',(uid(40),uid(41),load(40)['revision'],Jsonb(q),'review'),fragment='another passage')
    fail(c,'Phase 2 exact six policy','select public.m3_save_passage_bank(%s,%s,%s,%s,%s)',(uid(50),uid(51),reviewed['revision'],Jsonb(q[:5]),'review'),fragment='six')
    reviewed['passages'][0]['passageText']='New text invalidates review'; save(reviewed)
    check(all(v['reviewStatus']=='generated' for v in load()['passages'][0]['questions']),'Phase 2 text edits invalidate review')
    before_ids={v['id'] for v in load()['passages'][0]['questions']}
    bank(load(),51,questions,'generate')
    regenerated=load()['passages'][0]['questions']
    check(not before_ids.intersection(v['id'] for v in regenerated) and all(v['reviewStatus']=='generated' for v in regenerated),'Phase 2 regeneration replaces draft IDs and resets review')
    bank(load(),53,questions,'generate')
    check(sum(len(p['questions']) for p in load()['passages'])==12,'Phase 2 per-passage banks derive total twelve')
    issues=scalar(c,'select public.m3_collection_publish_issues(%s)',(uid(50),))
    check(any('Passage 2' in issue for issue in issues),'Phase 2 publish errors identify passage')
    fail(c,'Phase 2 direct publication enforces validation',"update public.modules set status='published' where id=%s",(uid(50),),fragment='Passage')
    check(scalar(c,'select public.m3_collection_publish_issues(%s)',(uid(40),))==[],'Phase 2 complete bank passes readiness')
    fail(c,'Phase 2 complete bank remains behind learner gate',"update public.modules set status='published' where id=%s",(uid(40),),fragment='Passage-aware learner delivery')
    fail(c,'Phase 2 published legacy module is protected','select public.m3_save_collection(%s,%s,%s,%s,%s,%s,%s)',(uid(11),load(11)['revision'],'Changed',uid(10),'Easy',Jsonb(load(11)['passages']),[]),fragment='historical')
    bank(load(),51,[],'delete')
    check(load()['passages'][0]['questions']==[],'Phase 2 explicit bank deletion')
    check(len(load()['passages'][1]['questions'])==6,'Phase 2 deletion preserves other bank')
    check(scalar(c,'select count(*) from public.comprehension_question_answers where question_id=%s',(q[0]['id'],))==0,'Phase 2 removed draft bank has no orphan keys')
    for role in ['anon','teacher','student','general_user']:
        claims(c,role)
        for name,query,args in [
          ('snapshot','select public.m3_admin_collection(%s)',(uid(50),)),
          ('update','select public.m3_save_collection(%s,0,%s,%s,%s,%s,%s)',(uid(50),'Denied',uid(10),'Easy',Jsonb([]),[])),
          ('bank','select public.m3_save_passage_bank(%s,%s,0,%s,%s)',(uid(50),uid(51),Jsonb([]),'delete'))]:
            fail(c,f'Phase 2 {role} {name} denied',query,args)
        if role!='anon':
            check(scalar(c,'select count(*) from public.comprehension_question_answers where question_id=%s',(uid(100),))==0,f'Phase 2 {role} module keys hidden')
    claims(c,'admin')
    check(scalar(c,'select count(*) from public.comprehension_questions where material_id=%s',(uid(20),))==1,'Phase 2 material bank preserved')
    claims(c,'teacher')
    check(len(c.execute("update public.comprehension_questions set question_text='Teacher still reviews material' where id=%s returning id",(uid(33),)).fetchall())==1,'Phase 2 Teacher material review remains authorized')
    c.execute('reset role')
    c.execute('create table public.oral_reading_attempts(id uuid primary key,module_id uuid references public.modules(id))')
    c.execute('insert into public.oral_reading_attempts values(%s,%s)',(uid(999),uid(50)))
    claims(c,'admin')
    fail(c,'Phase 2 existing oral history blocks destructive editing','select public.m3_save_passage_bank(%s,%s,%s,%s,%s)',(uid(50),uid(53),load()['revision'],Jsonb([]),'delete'),fragment='history')
