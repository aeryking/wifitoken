from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.lib.colors import HexColor, Color, white
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import simpleSplit
from pathlib import Path
P=Path(__file__).resolve().parent; out=P/'WiFiToken-作品介绍.pdf'
pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
W,H=960,540; c=canvas.Canvas(str(out),pagesize=(W,H)); c.setTitle('WiFi Token 作品介绍')
blue=HexColor('#2461df'); ink=HexColor('#18263b'); grey=HexColor('#53657a'); line=HexColor('#dfe8f2'); bg=HexColor('#f6f9fc'); green=HexColor('#008d71')
style=ParagraphStyle('b',fontName='STSong-Light',fontSize=11.5,leading=19,textColor=ink,wordWrap='CJK')
small=ParagraphStyle('s',parent=style,fontSize=10,leading=16,textColor=grey)
heading=ParagraphStyle('h',parent=style,fontSize=14,leading=20,textColor=ink)
def text(x,y,s,size=12,color=ink):
 c.setFont('STSong-Light',size); c.setFillColor(color); c.drawString(x,y,s)
def para(x,top,w,s,st=style):
 p=Paragraph(s,st); _,h=p.wrap(w,1000); p.drawOn(c,x,top-h); return top-h

def rect(x,y,w,h,fill=white,stroke=line):
 c.setFillColor(fill);c.setStrokeColor(stroke);c.roundRect(x,y,w,h,7,fill=1,stroke=1)
def base(n,k,title):
 c.setFillColor(bg);c.rect(0,0,W,H,fill=1,stroke=0);c.setFillColor(blue);c.rect(0,H-4,W,4,fill=1,stroke=0)
 display_n=n+1 if k not in ('项目背景','场景与问题','消费场景') else n
 text(48,498,f'{display_n:02d}  ·  {k}',10,blue);text(48,462,title,22,ink)
 text(48,27,'WiFi Token  ·  作品介绍',9,HexColor('#91a2b6'));text(904,27,str(c.getPageNumber()),9,HexColor('#91a2b6'))
def card(x,y,w,h,title,body):
 rect(x,y,w,h);text(x+17,y+h-26,title,14);para(x+17,y+h-40,w-34,body,small)
def bullet(lines): return '<br/>'.join('• '+s for s in lines)
# cover
c.setFillColor(bg);c.rect(0,0,W,H,fill=1,stroke=0);c.setFillColor(blue);c.rect(0,H-4,W,4,fill=1,stroke=0)
text(55,467,'开源智能硬件解决方案  ·  软硬一体原型',11,blue)
text(55,410,'WiFi Token',34);text(55,373,'买一杯咖啡，送一份 AI 体验额度',17,grey)
para(55,338,400,'把门店消费权益从一张优惠券，延伸为一次可使用、可计量、可控制预算的 AI 体验。',style)
text(55,244,'代码仓库   github.com/aeryking/wifitoken',10,grey)
text(55,222,'项目状态   软硬一体方案原型 · 硬件集成待验证',10,grey)
rect(514,170,390,290)
for i,(a,b) in enumerate([('门店设备','OpenWrt 配置代理'),('额度网关','虚拟 Key · 用量管理'),('模型服务','OpenAI 兼容上游')]):
 y=394-i*76;rect(544,y,330,55,HexColor('#f2f7ff'));text(561,y+30,a,13);text(561,y+11,b,10,grey)
for i,(v,l) in enumerate([('Docker','本机一键运行'),('2 种','Token / 金额额度'),('3 类','网关 / 数据库 / 模拟上游')]):
 x=55+i*150;rect(x,75,138,64);text(x+12,110,v,17,blue);text(x+12,90,l,9,grey)
c.showPage()
# page 2
base(1,'场景与问题','买咖啡送 Token：把 AI 体验变成门店权益')
card(48,247,420,175,'商家：想送权益，却担心失控',bullet(['买饮品送 AI 体验，可作为会员或营销权益。','直接共享上游 Key：无法按顾客控制额度。','固定预算之外，仍需要知道实际用了多少。']))
card(488,247,424,175,'顾客：坐下就能用 AI',bullet(['购买咖啡后，店员发放一份限额体验卡。','用于写邮件、整理笔记、做方案或学习。','额度和有效期清晰，无需拿到商家主 Key。']))
card(48,108,864,110,'现阶段的真实体验','目前可由管理员手动生成并交付虚拟 Key；顾客需在支持自定义 API 的客户端配置地址和 Key。自动随订单赠送、扫码领取和无配置体验尚未实现。')
c.showPage()
# scenario and illustrative cost: assumptions and official source shown explicitly.
base(2,'消费场景','一杯咖啡，附赠一份可计量的 AI 权益')
for i,(v,t,b) in enumerate([('01','购买饮品','顾客在店内购买咖啡，商家决定赠送体验额度。'),('02','发放权益','现阶段店员在后台手动生成限额虚拟 Key。'),('03','使用 AI','顾客在支持自定义 API 的客户端配置后使用。'),('04','查看用量','后台记录返回的 usage，额度耗尽后拒绝后续请求。')]):
 x=48+i*220;rect(x,270,205,135);text(x+15,379,v,20,blue);text(x+15,352,t,13);para(x+15,337,175,b,small)
rect(48,97,864,135,HexColor('#edf5ff'));text(67,205,'算一笔示例账：100 位顾客，每人赠送 10 万 Token',14)
para(67,190,824,'假设每人输入 8 万 Token、输出 2 万 Token，输入全部未命中缓存；按 DeepSeek Flash 空闲时段输入 ¥1 / 百万、输出 ¥4 / 百万计算，<b>约 ¥0.16 / 人，100 人约 ¥16</b>。峰时按官方同口径价格为约 ¥0.32 / 人。仅为情景估算，非已发生费用；未含设备、支付及运营成本。',small)
text(67,112,'价格来源：api-docs.deepseek.com/zh-cn/quick_start/pricing/（2026-11-01 核验）',9,grey)
c.showPage()
# page 3
base(2,'方案全貌','门店设备、额度网关与模型服务协作')
for x,title,body in [(48,'门店 / 设备','OpenWrt 代理<br/>获取短期配置<br/>本地保存配置文件'),(271,'管理后台','签发虚拟 Key<br/>额度与状态查询<br/>商户 / 设备归属'),(494,'网关与数据库','身份校验 · 转发<br/>用量计算 · 状态更新<br/>MySQL 持久化'),(717,'模型上游','OpenAI 兼容请求<br/>流式 / 非流式响应<br/>返回 usage')]: card(x,245,195,155,title,body)
for x in [247,470,693]: text(x,312,'→',18,blue)
rect(48,102,864,101,HexColor('#edf5ff'));para(68,178,824,'<b>关键边界：</b>客户端持有平台虚拟 Key；上游主 Key 由网关服务读取。当前代理负责领取并写入配置，完整 Portal、扫码领卡和设备端本地代理仍待开发。',style)
c.showPage()
# page 4
base(3,'硬件与部署','以 OpenWrt 设备为入口的软硬一体方案')
card(48,260,420,160,'设备侧已实现',bullet(['Go 代理请求控制端配置。','支持多个控制地址依次尝试。','写入本地配置文件，失败保留上一份。','提供 OpenWrt procd 与 ARM64 安装文件。']))
card(488,260,424,160,'网关侧已实现',bullet(['虚拟 Key 发放、撤销及状态查询。','额度计算、用量记录和上游转发。','管理员 / 商户管理接口与后台页面。','Docker Compose 与 MySQL 初始化。']))
rect(48,116,864,105,HexColor('#fff9ee'),HexColor('#f1e2bd'));para(67,197,824,'<b>当前状态：</b>OpenWrt 设备代理已做模拟控制端测试；尚未在本次独立副本中完成真实路由器安装、Wi-Fi 接入与门店环境联调。硬件型号和实物证据待补充。',style)
c.showPage()
# page 5
base(4,'核心流程','从额度签发到用量回写')
steps=[('01','创建额度','管理员选择 Token 或金额、数量和有效期。'),('02','签发凭据','生成虚拟 Key；数据库保存摘要，明文只在签发时返回。'),('03','发起请求','客户端携带虚拟 Key，请求聊天接口。'),('04','网关处理','校验状态与额度，以服务端上游密钥转发。'),('05','记录用量','解析上游 usage，更新额度；耗尽后后续请求拒绝。')]
for i,(n,t,b) in enumerate(steps):
 y=388-i*62;rect(48,y,864,52);text(64,y+19,n,15,blue);text(110,y+19,t,13);para(235,y+33,650,b,small)
c.showPage()
# page 6
base(5,'管理后台','面向平台管理员和商户的额度管理')
card(48,257,420,165,'管理员',bullet(['登录、生成及撤销虚拟 Key。','按 Token 或金额设置额度和有效期。','查看卡片、使用状态与累计用量。','创建商户账号，分配路由器归属。']))
card(488,257,424,165,'商户与设备',bullet(['商户按权限查看相关卡片和用量。','设备代理根据控制端地址获取配置。','多控制地址失败时保留最后一份配置。']))
rect(48,109,864,108);para(67,194,824,'<b>说明：</b>管理页面由网关服务提供，不等同于路由器本地管理界面。后台浏览器端完整操作与真实设备联动仍需验证；默认演示账户仅供本机使用。',style)
c.showPage()
# page 7
base(6,'验证结果','干净环境验证 Docker 启动与额度路径')
for i,(v,l,detail) in enumerate([('3 项','服务启动','网关、MySQL、模拟上游'),('8 张','数据库表','首次启动自动初始化'),('18 Token','模拟计量','调用后记录用量并耗尽'),('402','额度耗尽','后续请求被拒绝')]):
 x=48+i*220;rect(x,293,205,110);text(x+16,365,v,22,blue);text(x+16,342,l,12);text(x+16,320,detail,9,grey)
card(48,114,420,140,'本次已验证',bullet(['独立克隆 + 全新数据卷启动。','管理员登录 API；模拟上游请求。','MySQL 和网关重启后数据保留。']))
card(488,114,424,140,'尚未覆盖',bullet(['真实模型上游及真实费用。','OpenWrt 实物设备与实际门店。','浏览器端完整操作与生产负载。']))
c.showPage()
# page 8
base(7,'工程交付与发展','可运行的原型，持续补齐真实场景链路')
card(48,267,420,153,'本机运行',bullet(['Docker Desktop：docker compose up -d --build','自动初始化 MySQL 与本地模拟上游。','管理后台和健康检查通过本机访问。','源码、部署说明和测试脚本保存在仓库。']))
card(488,267,424,153,'测试与安全',bullet(['4 项 Node 计量单元测试。','Go 代理测试：写入、权限、失败保留。','虚拟 Key 摘要存储，上游密钥留在服务端。','共享设备凭据与计量可靠性需要增强。']))
card(48,105,420,135,'近期：硬件联调',bullet(['选定 OpenWrt 路由器并安装代理。','验证断网恢复、客户端配置与链路。','完善扫码领卡或门店接入体验。']))
card(488,105,424,135,'长期：场景验证',bullet(['逐设备身份、多实例一致性与审计。','开展真实门店试点，验证使用和成本。','确认项目授权协议与开源治理。']))
c.showPage();c.save();print(out)
