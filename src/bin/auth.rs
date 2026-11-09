//! Isolated system-webview login. Session output travels only over a private pipe.
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]
use anyhow::{Result, bail};
use serde_json::{Value, json};
use std::{
    io::{self, BufRead, IsTerminal},
    sync::mpsc,
    time::{Duration, Instant},
};
use tao::{
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoop},
    window::WindowBuilder,
};
use wry::WebViewBuilder;
struct Verification {
    cookies: Option<Vec<Value>>,
    status: Option<u16>,
    error: Option<String>,
}
async fn verify(
    endpoint: String,
    header: String,
    agent: String,
    cookies: Vec<Value>,
) -> Verification {
    let result = async {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(15))
            .user_agent(agent)
            .build()?;
        client
            .get(endpoint)
            .header("Accept", "application/json")
            .header("Cookie", header)
            .send()
            .await
    }
    .await;
    match result {
        Ok(response) => {
            let status = response.status().as_u16();
            let accepted = response.status().is_success()
                && response
                    .headers()
                    .get("content-type")
                    .and_then(|v| v.to_str().ok())
                    .is_some_and(|v| v.contains("application/json"));
            let accepted = accepted
                && response.json::<Value>().await.ok().is_some_and(|profile| {
                    profile["id"].as_u64().is_some()
                        || profile["id"].as_str().is_some_and(|s| !s.is_empty())
                });
            Verification {
                cookies: accepted.then_some(cookies),
                status: Some(status),
                error: None,
            }
        }
        Err(error) => Verification {
            cookies: None,
            status: None,
            error: Some(error.to_string()),
        },
    }
}
fn diagnostic(enabled: bool, value: Value) {
    if enabled {
        eprintln!("SIDEKICK_AUTH_DIAGNOSTIC {value}");
    }
}
fn main() -> Result<()> {
    if io::stdin().is_terminal() || io::stdout().is_terminal() {
        bail!("Launch this helper from Sidekick using private pipes");
    }
    let line = io::stdin()
        .lock()
        .lines()
        .next()
        .ok_or_else(|| anyhow::anyhow!("missing login configuration"))??;
    let config: Value = serde_json::from_str(&line)?;
    let login_url = config["url"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("missing URL"))?
        .to_owned();
    let origin = canvas_sidekick_rust::canvas::Canvas::new(&login_url)?.origin;
    let endpoint = format!("{origin}/api/v1/users/self/profile");
    let diagnostics = config["diagnostics"].as_bool().unwrap_or(false);
    let event_loop = EventLoop::new();
    let window = WindowBuilder::new()
        .with_title("Canvas Sidekick — Canvas login")
        .with_inner_size(tao::dpi::LogicalSize::new(800., 600.))
        .build(&event_loop)?;
    let (nav_tx, nav_rx) = mpsc::channel();
    let (verify_tx, verify_rx) = mpsc::channel::<Verification>();
    let (agent_tx, agent_rx) = mpsc::channel::<String>();
    let builder = WebViewBuilder::new()
        .with_url(&login_url)
        .with_incognito(true)
        .with_on_page_load_handler(move |_, _| {
            let _ = nav_tx.send(());
        });
    #[cfg(target_os = "linux")]
    let webview = {
        use tao::platform::unix::WindowExtUnix;
        use wry::WebViewBuilderExtUnix;
        builder.build_gtk(
            window
                .default_vbox()
                .ok_or_else(|| anyhow::anyhow!("GTK container unavailable"))?,
        )?
    };
    #[cfg(not(target_os = "linux"))]
    let webview = builder.build(&window)?;
    let (failure_tx, failure_rx) = mpsc::channel::<()>();
    #[cfg(target_os = "linux")]
    {
        use webkit2gtk::WebViewExt;
        use wry::WebViewExtUnix;
        webview
            .webview()
            .connect_load_failed(move |_, _, _, error| {
                // Redirects and superseded navigations are normal during SSO.
                if !error.matches(webkit2gtk::NetworkError::Cancelled)
                    && !error.matches(webkit2gtk::PolicyError::FrameLoadInterruptedByPolicyChange)
                {
                    let _ = failure_tx.send(());
                }
                false
            });
    }
    #[cfg(not(target_os = "linux"))]
    let _failure_tx = failure_tx;
    let started = Instant::now();
    let mut checking = false;
    let mut finished = false;
    let mut last_probe = Instant::now() - Duration::from_secs(2);
    let mut last_names = Vec::new();
    let mut agent = String::new();
    event_loop.run(move |event,_,flow| {
        *flow=ControlFlow::WaitUntil(Instant::now()+Duration::from_millis(100));
        if finished{*flow=ControlFlow::Exit;return;}
        let cancelled=matches!(event,Event::WindowEvent{event:WindowEvent::CloseRequested,..});
        let load_failed = failure_rx.try_recv().is_ok();
        if cancelled||load_failed||started.elapsed()>Duration::from_secs(180){
            finished=true;
            println!("{}",json!({"type":"failed","reason":if cancelled{"cancelled"}else if load_failed{"load-failed"}else{"timeout"}}));
            *flow=ControlFlow::Exit;
            return;
        }
        if let Ok(result)=verify_rx.try_recv(){
            checking=false;
            diagnostic(diagnostics,json!({"probeStatus":result.status,"error":result.error}));
            if let Some(cookies)=result.cookies{
                finished=true;
                println!("{}",json!({"type":"authenticated","origin":origin,"cookies":cookies,"userAgent":agent}));
                *flow=ControlFlow::Exit;
                return;
            }
        }
        if let Ok(value)=agent_rx.try_recv(){agent=value;}
        let navigation=nav_rx.try_iter().count()>0;
        if !checking&&(navigation||last_probe.elapsed()>Duration::from_secs(1)){
            last_probe=Instant::now();
            if agent.is_empty(){
                let tx=agent_tx.clone();
                let _=webview.evaluate_script_with_callback("navigator.userAgent",move |value|{if let Ok(agent)=serde_json::from_str::<String>(&value){let _=tx.send(agent);}});
                return;
            }
            match webview.cookies_for_url(&endpoint){
                Ok(cookies)=>{
                    let names:Vec<_>=cookies.iter().map(|c|c.name().to_owned()).collect();
                    if names!=last_names{diagnostic(diagnostics,json!({"cookieNames":names}));last_names=names;}
                    // The authenticated endpoint is the authority, not a cookie's name.
                    if cookies.is_empty(){return;}
                    checking=true;
                    let serialized:Vec<Value>=cookies.iter().map(|c|json!({"name":c.name(),"value":c.value(),"domain":c.domain(),"path":c.path(),"secure":c.secure(),"httpOnly":c.http_only(),"sameSite":c.same_site().map(|s|s.to_string()),"expirationDate":c.expires_datetime().map(|t|t.unix_timestamp())})).collect();
                    let header=cookies.iter().map(|c|format!("{}={}",c.name(),c.value())).collect::<Vec<_>>().join("; ");
                    let tx=verify_tx.clone();let endpoint=endpoint.clone();let agent=agent.clone();
                    std::thread::spawn(move ||{
                        let result=match tokio::runtime::Runtime::new(){
                            Ok(rt)=>rt.block_on(verify(endpoint,header,agent,serialized)),
                            Err(error)=>Verification{cookies:None,status:None,error:Some(error.to_string())},
                        };
                        let _=tx.send(result);
                    });
                }
                Err(error)=>diagnostic(diagnostics,json!({"cookieError":error.to_string()})),
            }
        }
    });
}
