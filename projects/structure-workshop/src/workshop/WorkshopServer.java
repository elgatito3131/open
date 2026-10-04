package workshop;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

/** Local-only server for independent Java experiments. No external dependencies. */
public final class WorkshopServer {
    private static final int PORT = 4197;
    private static final int MAX_BODY = 16 * 1024;
    private final Path webRoot;
    private final Map<String,String> sources = new LinkedHashMap<>();
    private final Map<String,Map<String,Integer>> lines = new LinkedHashMap<>();

    public static final List<Map<String,String>> LABS = List.of(
        lab("pair", "Generic Pair", "Generics, references, and swapping", "PairLab.java", "Initial pair", "12,27",
            "swap\nleft 8\nclear right\nright 42", "left VALUE · right VALUE · swap · clear left/right. Use two integers, or _ for an empty side."),
        lab("array", "Array List", "Resizable array, inserts, and removals", "DynamicBuffer.java", "Initial values", "12,27,41",
            "append 8\ninsert 1 24\nremove 2\nset 0 9", "append VALUE · insert INDEX VALUE · remove INDEX · set INDEX VALUE. Indexes start at 0."),
        lab("link", "Doubly Linked List", "Previous/next pointers, undo, and lookup", "LinkLab.java", "Initial node names", "fern,moss,reed",
            "insert-after moss ivy\nremove fern\nfind reed\nundo", "insert-after EXISTING NEW · prepend NEW · remove NAME · find NAME · undo"),
        lab("branch", "Tree & Hash Table", "First-child/next-sibling tree and hash index", "BranchLab.java", "Root name", "grove",
            "add grove fern\nadd grove iris\nadd fern moss\nfind moss\npreorder\nlevelorder", "add PARENT CHILD · find NAME · remove-leaf NAME · preorder · levelorder"),
        lab("dependency", "Topological Sort", "Directed graph, indexed min-heap, and ordering", "DependencyLab.java", "Initial tasks", "sketch,cut,assemble,paint",
            "link sketch cut\nlink cut assemble\nlink assemble paint\norder", "link BEFORE AFTER · order. A dependency goes from the prerequisite to the task that needs it.")
    );
    private static Map<String,String> lab(String id,String title,String subtitle,String file,String label,String initial,String operations,String help) {
        return Map.of("id",id,"title",title,"subtitle",subtitle,"sourceFile",file,"initialLabel",label,
            "initial",initial,"operations",operations,"help",help);
    }
    private WorkshopServer(Path root) throws IOException {
        webRoot = root.resolve("web").toRealPath();
        Pattern marker = Pattern.compile("// @source ([a-zA-Z0-9_.-]+)");
        for (Map<String,String> lab : LABS) {
            String file = lab.get("sourceFile");
            Path source = file.equals("DynamicBuffer.java")
                ? root.resolve("../array-observatory/src/observatory/DynamicBuffer.java")
                : root.resolve("src/workshop").resolve(file);
            String content = Files.readString(source);
            sources.put(file,content);
            Map<String,Integer> positions = new LinkedHashMap<>();
            String[] split = content.split("\\R",-1);
            for (int i=0;i<split.length;i++) {
                var match=marker.matcher(split[i]);
                if (match.find() && positions.putIfAbsent(match.group(1),i+1)!=null)
                    throw new IllegalStateException("Duplicate source marker in " + file);
            }
            lines.put(file,positions);
        }
    }
    public static void main(String[] args) throws IOException {
        Path root=(args.length==0?Path.of("."):Path.of(args[0])).toAbsolutePath().normalize();
        WorkshopServer app=new WorkshopServer(root);
        HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",PORT),16);
        server.createContext("/",app::handle);
        server.setExecutor(Executors.newFixedThreadPool(4));
        Runtime.getRuntime().addShutdownHook(new Thread(()->server.stop(0)));
        server.start();
        System.out.println("Data Structures Workshop is ready at http://127.0.0.1:"+PORT+"/?lab=link");
        System.out.println("Press Ctrl+C to stop. Java performs all operations locally.");
    }
    private void handle(HttpExchange exchange) throws IOException {
        try {
            String path=exchange.getRequestURI().getPath();
            String method=exchange.getRequestMethod();
            if (path.equals("/api/trace")) {
                if (!method.equals("POST")) { methodError(exchange,"POST"); return; }
                String type=exchange.getRequestHeaders().getFirst("Content-Type");
                if (type==null || !type.split(";",2)[0].strip().equalsIgnoreCase("application/x-www-form-urlencoded"))
                    throw new IllegalArgumentException("Use form-encoded inputs.");
                byte[] bytes=exchange.getRequestBody().readNBytes(MAX_BODY+1);
                if (bytes.length>MAX_BODY) throw new IllegalArgumentException("Inputs exceed 16 KiB.");
                Map<String,String> form=parseForm(new String(bytes,StandardCharsets.UTF_8));
                for (String key:form.keySet()) if (!List.of("lab","initial","operations").contains(key))
                    throw new IllegalArgumentException("Unknown input field: "+key);
                String id=form.getOrDefault("lab", "link");
                Map<String,String> meta=LABS.stream().filter(l->l.get("id").equals(id)).findFirst()
                    .orElseThrow(()->new IllegalArgumentException("Choose a listed project."));
                String initial=form.getOrDefault("initial", "");
                String operations=form.getOrDefault("operations", "");
                if (operations.lines().filter(s->!s.isBlank()).count()>24) throw new IllegalArgumentException("Use at most 24 instructions.");
                LabTrace trace=runLab(id,initial,operations);
                sendJson(exchange,200,traceJson(trace,meta.get("sourceFile")));
            } else if (path.startsWith("/api/")) {
                if (!method.equals("GET")) { methodError(exchange,"GET"); return; }
                switch(path) {
                    case "/api/health" -> sendJson(exchange,200,Map.of("status","ok","app","structure-workshop"));
                    case "/api/labs" -> sendJson(exchange,200,LABS);
                    case "/api/source" -> {
                        Map<String,String> query=parseForm(exchange.getRequestURI().getRawQuery());
                        String file=query.getOrDefault("file", "");
                        if(query.size()!=1 || !sources.containsKey(file)) throw new IllegalArgumentException("Choose a listed Java source file.");
                        sendJson(exchange,200,Map.of("file",file,"content",sources.get(file)));
                    }
                    default -> sendError(exchange,404,"Endpoint not found.");
                }
            } else {
                if (!method.equals("GET") && !method.equals("HEAD")) { methodError(exchange,"GET, HEAD"); return; }
                if(path.contains("\\") || path.indexOf('\0')>=0) { sendError(exchange,404,"Asset not found.");return; }
                Path file=webRoot.resolve(path.equals("/")?"index.html":path.substring(1)).normalize();
                if(!file.startsWith(webRoot)||!Files.isRegularFile(file)||!file.toRealPath().startsWith(webRoot)) {
                    sendError(exchange,404,"Asset not found."); return;
                }
                String name=file.getFileName().toString();
                String type=name.endsWith(".html")?"text/html; charset=utf-8":name.endsWith(".css")?"text/css; charset=utf-8"
                    :name.endsWith(".js")?"text/javascript; charset=utf-8":"application/octet-stream";
                send(exchange,200,type,Files.readAllBytes(file));
            }
        } catch(IllegalArgumentException|IndexOutOfBoundsException error) {
            sendError(exchange,400,error.getMessage()==null?"Invalid inputs.":error.getMessage());
        } catch(Exception error) {
            System.err.println("Request failed: "+error.getClass().getSimpleName());
            sendError(exchange,500,"The local app could not prepare this sequence.");
        } finally { exchange.close(); }
    }
    static LabTrace runLab(String id,String initial,String instructions) {
        return switch(id) {
            case "pair" -> PairLab.run(initial,instructions);
            case "array" -> ArrayLab.run(initial,instructions);
            case "link" -> LinkLab.run(initial,instructions);
            case "branch" -> BranchLab.run(initial,instructions);
            case "dependency" -> DependencyLab.run(initial,instructions);
            default -> throw new IllegalArgumentException("Unknown project.");
        };
    }
    private Map<String,Object> traceJson(LabTrace trace,String file) {
        List<Map<String,Object>> frames=new ArrayList<>();
        if(trace.frames().size()>4096) throw new IllegalArgumentException("Sequence produces too many steps. Try fewer instructions.");
        for(LabTrace.Frame frame:trace.frames()) {
            Map<String,Object> row=new LinkedHashMap<>();
            row.put("operationIndex",frame.operationIndex());row.put("operation",frame.operation());
            row.put("phase",frame.phase());row.put("title",frame.title());row.put("message",frame.message());
            row.put("note",frame.note());row.put("view",frame.view());
            if(frame.sourceId()==null) row.put("source",null);
            else {
                Integer line=lines.get(file).get(frame.sourceId());
                if(line==null) throw new IllegalStateException("Missing source marker: "+frame.sourceId());
                row.put("source",Map.of("file",file,"line",line));
            }
            frames.add(row);
        }
        return Map.of("operations",trace.operations(),"frames",frames);
    }
    static Map<String,String> parseForm(String encoded) {
        Map<String,String> form=new LinkedHashMap<>();
        if(encoded==null || encoded.isEmpty()) return form;
        for(String field:encoded.split("&",-1)) {
            if(field.isEmpty()) continue;
            String[] pair=field.split("=",2);
            String key=URLDecoder.decode(pair[0],StandardCharsets.UTF_8);
            String value=URLDecoder.decode(pair.length==2?pair[1]:"",StandardCharsets.UTF_8);
            if(form.putIfAbsent(key,value)!=null) throw new IllegalArgumentException("Duplicate input: "+key);
        }
        return form;
    }
    static String json(Object value) {
        if(value==null) return "null";
        if(value instanceof String text) {
            StringBuilder out=new StringBuilder("\"");
            for(int i=0;i<text.length();i++) {
                char c=text.charAt(i);
                switch(c) {
                    case '"' -> out.append("\\\"");case '\\' -> out.append("\\\\");
                    case '\n' -> out.append("\\n");case '\r' -> out.append("\\r");case '\t' -> out.append("\\t");
                    default -> { if(c<32) out.append(String.format("\\u%04x",(int)c));else out.append(c); }
                }
            }
            return out.append('"').toString();
        }
        if(value instanceof Number || value instanceof Boolean) return value.toString();
        if(value instanceof Map<?,?> map) {
            List<String> parts=new ArrayList<>();
            map.forEach((key,item)->parts.add(json(key.toString())+":"+json(item)));
            return "{"+String.join(",",parts)+"}";
        }
        if(value instanceof List<?> list) return "["+String.join(",",list.stream().map(WorkshopServer::json).toList())+"]";
        throw new IllegalArgumentException("Unsupported JSON value.");
    }
    private static void methodError(HttpExchange ex,String allow) throws IOException {
        ex.getResponseHeaders().set("Allow",allow);sendError(ex,405,"Use "+allow+" for this endpoint.");
    }
    private static void sendError(HttpExchange ex,int status,String text) throws IOException {sendJson(ex,status,Map.of("error",text));}
    private static void sendJson(HttpExchange ex,int status,Object body) throws IOException {
        send(ex,status,"application/json; charset=utf-8",json(body).getBytes(StandardCharsets.UTF_8));
    }
    private static void send(HttpExchange ex,int status,String type,byte[] body) throws IOException {
        ex.getResponseHeaders().set("Content-Type",type);
        ex.getResponseHeaders().set("Cache-Control","no-store");
        ex.getResponseHeaders().set("X-Content-Type-Options","nosniff");
        ex.getResponseHeaders().set("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
        if(ex.getRequestMethod().equals("HEAD")) {
            ex.getResponseHeaders().set("Content-Length",Integer.toString(body.length));ex.sendResponseHeaders(status,-1);
        } else { ex.sendResponseHeaders(status,body.length);ex.getResponseBody().write(body); }
    }
}
