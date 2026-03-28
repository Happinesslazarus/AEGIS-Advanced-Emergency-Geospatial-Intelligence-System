const {execSync}=require('child_process');
try {
  const r=execSync('netstat -ano',{encoding:'utf8'});
  const m=r.match(/TCP.*:3001\s+.*LISTENING\s+(\d+)/);
  if(m){execSync('taskkill /F /PID '+m[1]);console.log('KILLED:'+m[1])}
  else{console.log('FREE')}
} catch(e){console.log('ERR:'+e.message.slice(0,200))}
