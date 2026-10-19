using System;using System.IO;using System.Text;using System.Threading;using System.Media;
class BadApple{
 static void Main(string[] a){
  if(a.Length<1){Console.WriteLine("usage: ba.exe frames.gray [inv] [audio.wav]");return;}
  string raw=a[0];bool inv=false;string wav=null;
  for(int i=1;i<a.Length;i++){if(a[i]=="inv")inv=true;else wav=a[i];}
  int w=88,h=33;byte[] d=File.ReadAllBytes(raw);int fs=w*h;int fn=d.Length/fs;
  string r=" .:-=+*#%@";int rl=r.Length-1;char[] m=new char[256];
  for(int i=0;i<256;i++){int k=inv?(255-i)*rl/255:i*rl/255;m[i]=r[k];}
  SoundPlayer sp=null;
  if(wav!=null&&File.Exists(wav)){try{sp=new SoundPlayer(wav);sp.Load();}catch{}}
  try{Console.CursorVisible=false;}catch{}
  var sb=new StringBuilder((w+1)*h);int fps=15;int fm=1000/fps;
  if(sp!=null){try{sp.Play();}catch{}}
  var sw=System.Diagnostics.Stopwatch.StartNew();
  for(int f=0;f<fn;f++){
   sb.Length=0;int off=f*fs;
   for(int y=0;y<h;y++){int row=off+y*w;for(int x=0;x<w;x++)sb.Append(m[d[row+x]]);sb.Append('\n');}
   try{Console.SetCursorPosition(0,0);}catch{}
   Console.Write(sb.ToString());
   long t=(long)(f+1)*fm;int wait=(int)(t-sw.ElapsedMilliseconds);
   if(wait>0)Thread.Sleep(wait);
  }
  if(sp!=null){try{sp.Stop();}catch{}}
  try{Console.SetCursorPosition(0,h);Console.CursorVisible=true;}catch{}
  Console.WriteLine();
 }
}