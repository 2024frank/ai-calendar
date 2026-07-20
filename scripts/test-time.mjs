// Pure-logic copy of src/lib/time.ts to test without the module system.
function zoneOffsetMinutes(utcMs, tz){const parts=new Intl.DateTimeFormat("en-US",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).formatToParts(new Date(utcMs));const g=t=>Number(parts.find(p=>p.type===t)?.value??0);const asUtc=Date.UTC(g("year"),g("month")-1,g("day"),g("hour")%24,g("minute"),g("second"));return Math.round((asUtc-utcMs)/60000);}
function parseWall(s){s=s.trim();const iso=/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s);if(iso)return{y:+iso[1],mo:+iso[2]-1,d:+iso[3],h:iso[4]?+iso[4]:0,mi:iso[5]?+iso[5]:0};return null;}
function wallToUnix(w,tz){const naive=Date.UTC(w.y,w.mo,w.d,w.h,w.mi);let off=zoneOffsetMinutes(naive,tz);let real=naive-off*60000;const off2=zoneOffsetMinutes(real,tz);if(off2!==off){off=off2;real=naive-off*60000;}return Math.floor(real/1000);}
function toUnix(s,tz,ref){const w=parseWall(s);if(!w)return 0;let u=wallToUnix(w,tz);if(ref!=null){const cy=new Date(ref).getUTCFullYear(),r=Math.floor(ref/1000),DAY=86400;if(w.y<cy&&u<r-DAY){for(let y=cy;y<=cy+1;y++){const rolled=wallToUnix({...w,y},tz);if(rolled>=r-DAY){u=rolled;break;}}}}return u;}

const TZ="America/New_York", now=Date.parse("2026-07-20T20:00:00Z");
const show=(label,iso)=>{const u=toUnix(iso,TZ,now);console.log(`  ${label.padEnd(30)} "${iso}" -> ${new Date(u*1000).toLocaleString("en-US",{timeZone:TZ})}`);};
console.log("today (ET): 2026-07-20 ~4pm");
show("Summer Art Camp Jul 27",    "2026-07-27T12:30");
show("Acrylic (year missing)",    "2025-08-04T19:50"); // wrong year the model gave -> should roll to 2026
show("Camp Aug 10 (past year)",   "2025-08-10T08:10");
show("A DST winter date",         "2026-12-05T19:00");
show("A DST summer date",         "2026-07-04T21:00");
show("year-only-off by nothing",  "2026-09-15T18:00");
