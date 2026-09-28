# -*- coding: utf-8 -*-
import json, os, ssl, sys, time, urllib.parse, urllib.request
C=ssl.create_default_context(); C.check_hostname=False; C.verify_mode=ssl.CERT_NONE
H={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
R=[("DJDQfff/NetliteratureCollection","main"),("ChengzhuLi/Novel","master"),("span-man/ebooks","master")]
ROOT=os.path.join(os.path.dirname(os.path.abspath(__file__)),"books")
def get(u,ts=6):
 for i in range(ts):
  try:return urllib.request.urlopen(urllib.request.Request(u,headers=H),timeout=60,context=C).read()
  except Exception:time.sleep(2*i)
 return b""
def tree(repo,b):
 d=json.loads(get("https://api.github.com/repos/%s/git/trees/%s?recursive=1"%(repo,b)).decode("utf-8","ignore"))
 return[t["path"] for t in d.get("tree",[]) if t.get("type")=="blob" and t["path"].lower().endswith(".txt")]
def dl(repo,b,p,out):
 u="https://raw.githubusercontent.com/%s/%s/%s"%(repo,b,urllib.parse.quote(p))
 for i in range(1,5):
  try:open(out,"wb").write(get(u,1));return os.path.getsize(out)>0
  except Exception:time.sleep(4*i)
 return False
def main():
 lim=int(sys.argv[sys.argv.index("--limit")+1]) if "--limit" in sys.argv else None; okt=0; fa=[]
 for repo,b in R:
  out=os.path.join(ROOT,repo.replace("/","_")); os.makedirs(out,exist_ok=True); print("==%s=="%repo)
  ps=tree(repo,b); print(" txt数",len(ps)); ok=0
  for i,p in enumerate(ps):
   if lim and i>=lim:break
   fp=os.path.join(out,os.path.basename(p))
   if os.path.exists(fp) and os.path.getsize(fp)>0: ok+=1; continue
   if dl(repo,b,p,fp): ok+=1; print("  ok %s %dKB"%(os.path.basename(p),os.path.getsize(fp)//1024))
   else: fa.append(p); print("  FAIL",os.path.basename(p))
   time.sleep(0.3)
  okt+=ok; print(" [%s] ok%d"%(repo,ok))
 print("== ok%d fail%d =="%(okt,len(fa)))
 for f in fa:print("  ",f)
if __name__=="__main__": main()