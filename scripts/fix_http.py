"""Patch wasi-http-client 0.2.1: start the request first, then stream the body in 4 KB chunks.
(The original writes the whole body before starting the request, which fails or hangs above 4 KB.)"""
import sys
p = sys.argv[1]
s = open(p).read()
old_start = s.index("        let outgoing_body = req")
old_end = s.index("        let incoming_response = match future_response.get()")
new = '''        let outgoing_body = req
            .body()
            .map_err(|_| anyhow!("outgoing request write failed"))?;

        let options = RequestOptions::new();
        options
            .set_connect_timeout(self.connect_timeout)
            .map_err(|()| anyhow!("failed to set connect_timeout"))?;

        // Start the request first, so a large body can stream out in chunks.
        let future_response = outgoing_handler::handle(req, Some(options))?;

        if let Some(body) = self.body {
            let request_body = outgoing_body
                .write()
                .map_err(|_| anyhow!("outgoing request write failed"))?;
            for chunk in body.chunks(4096) {
                request_body.blocking_write_and_flush(chunk)?;
            }
            drop(request_body);
        }
        OutgoingBody::finish(outgoing_body, None)?;

'''
s = s[:old_start] + new + s[old_end:]
open(p, "w").write(s)
print("patched", p)
