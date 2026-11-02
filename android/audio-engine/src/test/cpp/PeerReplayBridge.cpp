// Host test bridge: real Engine + exact repository-downloaded PCM WAV; no Android decoder/output.
#include "../../main/cpp/Engine.h"
#include <algorithm>
#include <cmath>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <memory>
#include <sstream>
#include <string>
#include <vector>
using namespace manadj;
static uint32_t le(const unsigned char* p, int n) { uint32_t v=0; for(int i=0;i<n;++i) v|=uint32_t(p[i])<<(8*i); return v; }
static bool wav(Engine& e, int d, uint64_t id, const std::string& path, std::vector<float>& out) {
    std::ifstream file(path, std::ios::binary);
    std::vector<unsigned char> bytes((std::istreambuf_iterator<char>(file)), {});
    if(bytes.size()<44 || std::string(bytes.begin(),bytes.begin()+4)!="RIFF" || std::string(bytes.begin()+8,bytes.begin()+12)!="WAVE") return false;
    int channels=0, rate=0; size_t data=0, length=0;
    for(size_t at=12;at+8<=bytes.size();) {
        auto n=le(bytes.data()+at+4,4); if(n>bytes.size()-at-8) return false;
        std::string kind(bytes.begin()+at,bytes.begin()+at+4);
        if(kind=="fmt ") { if(n<16 || le(bytes.data()+at+8,2)!=1 || le(bytes.data()+at+22,2)!=16) return false; channels=le(bytes.data()+at+10,2); rate=le(bytes.data()+at+12,4); }
        if(kind=="data") { data=at+8; length=n; }
        at+=8+n+(n%2);
    }
    if((channels!=1 && channels!=2) || rate<8000 || !data || length%(channels*2)) return false;
    const int frames=length/(channels*2); if(!frames) return false;
    if(!e.submit(Op::Prepare,d,0,id)) return false;
    e.render(out.data(),1);
    if(!e.trackBegin(d,id,frames,rate,0)) return false;
    std::vector<float> pcm(static_cast<size_t>(frames)*2);
    for(int i=0;i<frames;++i) for(int c=0;c<2;++c) pcm[i*2+c]=static_cast<int16_t>(le(bytes.data()+data+(i*channels+std::min(c,channels-1))*2,2))/32768.f;
    for(int at=0;at<frames;at+=4096) if(e.trackWrite(d,id,pcm.data()+at*2,std::min(4096,frames-at))<=0) return false;
    e.trackFinish(d,id);
    auto transport=e.deck(d).transport.load();
    return e.claim(d,id,transport,rate,0) && e.offer(d,transport,pcm.data(),std::min(frames,4096))>0 && e.publish(d,id,transport,false);
}
int main() {
    auto owned=std::make_unique<Engine>(48000); auto& e=*owned;
    std::vector<float> out(8192); double energy=0; std::ofstream capture;
    for(std::string line;std::getline(std::cin,line);) {
        std::istringstream in(line); std::string command; in>>command; bool ok=true;
        if(command=="wav") { int d;uint64_t id;std::string path;in>>d>>id>>std::quoted(path);ok=wav(e,d,id,path,out); }
        else if(command=="capture") { std::string path;in>>std::quoted(path);capture.open(path,std::ios::binary);ok=capture.good(); }
        else if(command=="render") { int frames;in>>frames;while(frames>0) {int n=std::min(frames,4096);e.render(out.data(),n);frames-=n;for(int i=0;i<n*2;++i) energy+=out[i]*out[i];if(capture.is_open()) capture.write(reinterpret_cast<const char*>(out.data()),n*2*sizeof(float));} }
        else if(command=="cancel") {uint64_t tag;in>>tag;ok=e.cancelScheduled(tag)!=0;}
        else if(command=="op") {
            uint64_t frame,tag;int d;std::string op;double v,a,b;in>>frame>>tag>>op>>d>>v>>a>>b;
            Engine::ScheduleScope stamp(frame,tag);
            if(op=="locate") {double aux[5]={a,b,0,0,0};ok=e.submit(Op::LoopSet,d,v,0,0,aux)!=0;}
            else if(op=="filter") ok=e.submitFilter(d,v)!=0;
            else if(op=="fx-off") ok=e.submitBeatFx(-1,4,false,-1,1,0)!=0;
            else {
                Op type;
                if(op=="play") type=Op::Play;else if(op=="pause") type=Op::Pause;else if(op=="pitch") type=Op::Pitch;
                else if(op=="bend") type=Op::Bend;else if(op=="fader") type=Op::Fader;else if(op=="eq") type=Op::Eq;
                else return 3;
                ok=e.submit(type,d,v,0,static_cast<int>(a))!=0;
            }
        } else if(command!="clock") return 4;
        std::cout<<std::setprecision(17)<<ok<<' '<<e.outputFrames()<<' '<<e.lateOps()<<' '<<energy;
        for(int d=0;d<4;++d) std::cout<<' '<<e.deck(d).position.load();
        std::cout<<std::endl;
    }
}
