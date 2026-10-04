package observatory;

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
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Stateless, local-only bridge from the browser controls to the Java engine. */
public final class TraceServer {
    private static final int PORT = 4196;
    private static final int MAX_BODY_BYTES = 16 * 1024;
    private static final int MAX_INITIAL_VALUES = 16;
    private static final int MAX_OPERATIONS = 32;
    private static final Map<String, String> SOURCE_LABELS = Map.of(
            "DynamicBuffer.java", "Generic array engine",
            "TraceServer.java", "Local HTTP API");
    private final Path webRoot;
    private final Map<String, String> sourceContents = new LinkedHashMap<>();
    private final Map<String, Integer> sourceLines = new LinkedHashMap<>();

    private TraceServer(Path root) throws IOException {
        webRoot = root.resolve("web").toRealPath();
        for (String filename : List.of("DynamicBuffer.java", "TraceServer.java")) {
            sourceContents.put(filename, Files.readString(root.resolve("src/observatory").resolve(filename)));
        }
        String[] lines = sourceContents.get("DynamicBuffer.java").split("\\R", -1);
        Pattern marker = Pattern.compile("// @source ([a-z.]+)");
        for (int index = 0; index < lines.length; index++) {
            Matcher match = marker.matcher(lines[index]);
            if (match.find()) sourceLines.put(match.group(1), index + 1);
        }
    }

    public static void main(String[] args) throws IOException {
        Path root = (args.length == 0 ? Path.of(".") : Path.of(args[0])).toAbsolutePath().normalize();
        TraceServer application = new TraceServer(root);
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", PORT), 16);
        server.createContext("/", application::handle);
        server.setExecutor(Executors.newFixedThreadPool(4));
        Runtime.getRuntime().addShutdownHook(new Thread(() -> server.stop(0)));
        server.start();
        System.out.println("Array Observatory is ready at http://127.0.0.1:" + PORT);
        System.out.println("Press Ctrl+C to stop. Everything runs on this computer.");
    }

    private void handle(HttpExchange exchange) throws IOException {
        try {
            String path = exchange.getRequestURI().getPath();
            String method = exchange.getRequestMethod();
            if (path.equals("/api/trace")) {
                if (!method.equals("POST")) {
                    exchange.getResponseHeaders().set("Allow", "POST");
                    sendError(exchange, 405, "Use POST for /api/trace.");
                    return;
                }
                String contentType = exchange.getRequestHeaders().getFirst("Content-Type");
                if (contentType == null || !contentType.split(";", 2)[0].strip()
                        .equalsIgnoreCase("application/x-www-form-urlencoded")) {
                    throw new IllegalArgumentException("Send application/x-www-form-urlencoded data.");
                }
                byte[] body = exchange.getRequestBody().readNBytes(MAX_BODY_BYTES + 1);
                if (body.length > MAX_BODY_BYTES) throw new IllegalArgumentException("Request body exceeds 16 KiB.");
                sendJson(exchange, 200, trace(parseForm(new String(body, StandardCharsets.UTF_8))));
            } else if (path.startsWith("/api/")) {
                if (!method.equals("GET")) {
                    exchange.getResponseHeaders().set("Allow", "GET");
                    sendError(exchange, 405, "Use GET for this endpoint.");
                    return;
                }
                switch (path) {
                    case "/api/health" -> sendJson(exchange, 200, "{\"status\":\"ok\",\"app\":\"array-observatory\"}");
                    case "/api/sources" -> sendSources(exchange);
                    case "/api/source" -> sendSource(exchange);
                    default -> sendError(exchange, 404, "API endpoint not found.");
                }
            } else {
                if (!method.equals("GET") && !method.equals("HEAD")) {
                    exchange.getResponseHeaders().set("Allow", "GET, HEAD");
                    sendError(exchange, 405, "Use GET or HEAD for static assets.");
                    return;
                }
                sendStatic(exchange, path);
            }
        } catch (IllegalArgumentException | IndexOutOfBoundsException | IllegalStateException error) {
            sendError(exchange, 400, error.getMessage() == null ? "Invalid request." : error.getMessage());
        } catch (Exception error) {
            System.err.println("Request failed: " + error.getClass().getSimpleName());
            sendError(exchange, 500, "The local server could not complete this request.");
        } finally {
            exchange.close();
        }
    }

    private String trace(Map<String, String> form) {
        for (String field : form.keySet()) {
            if (!List.of("initial", "operations", "growth").contains(field)) {
                throw new IllegalArgumentException("Unknown form field: " + field);
            }
        }
        DynamicBuffer.Growth growth = switch (form.getOrDefault("growth", "double")) {
            case "double" -> DynamicBuffer.Growth.DOUBLE;
            case "balanced" -> DynamicBuffer.Growth.BALANCED;
            default -> throw new IllegalArgumentException("Growth must be double or balanced.");
        };
        List<Integer> initialValues = new ArrayList<>();
        String initialText = form.getOrDefault("initial", "").strip();
        if (!initialText.isEmpty()) {
            String[] values = initialText.split(",", -1);
            if (values.length > MAX_INITIAL_VALUES) throw new IllegalArgumentException("Use at most 16 initial values.");
            for (String value : values) initialValues.add(parseInteger(value.strip(), "Initial value"));
        }
        List<String> commands = form.getOrDefault("operations", "").lines()
                .map(String::strip).filter(line -> !line.isEmpty()).toList();
        if (commands.size() > MAX_OPERATIONS) throw new IllegalArgumentException("Use at most 32 operations.");
        DynamicBuffer<Integer> buffer = new DynamicBuffer<>(initialValues, growth);
        DynamicBuffer.Snapshot<Integer> initial = buffer.snapshot();
        for (int index = 0; index < commands.size(); index++) {
            try {
                execute(buffer, commands.get(index));
            } catch (IllegalArgumentException | IndexOutOfBoundsException | IllegalStateException error) {
                throw new IllegalArgumentException("Operation " + (index + 1) + ": " + error.getMessage());
            }
        }
        StringBuilder json = new StringBuilder("{\"initial\":");
        appendSnapshot(json, initial, false);
        json.append(",\"steps\":[");
        boolean first = true;
        for (DynamicBuffer.Step<Integer> step : buffer.steps()) {
            if (!first) json.append(',');
            first = false;
            json.append("{\"index\":").append(step.index())
                    .append(",\"operationIndex\":").append(step.operationIndex())
                    .append(",\"operation\":").append(quote(step.operation()))
                    .append(",\"phase\":").append(quote(step.phase()))
                    .append(",\"message\":").append(quote(step.message()))
                    .append(",\"slots\":");
            appendNumbers(json, step.slots());
            json.append(",\"size\":").append(step.size()).append(",\"capacity\":").append(step.capacity())
                    .append(",\"oldSlots\":");
            appendNumbers(json, step.oldSlots());
            json.append(",\"activeIndices\":");
            appendNumbers(json, step.activeIndices());
            json.append(",\"metrics\":");
            appendMetrics(json, step.metrics());
            Integer line = sourceLines.get(step.sourceId());
            if (line == null) throw new IllegalStateException("Missing source marker: " + step.sourceId());
            json.append(",\"source\":{\"file\":\"DynamicBuffer.java\",\"line\":").append(line).append("}}");
        }
        json.append("],\"final\":");
        appendSnapshot(json, buffer.snapshot(), true);
        json.append(",\"operations\":[");
        for (int index = 0; index < buffer.operations().size(); index++) {
            if (index > 0) json.append(',');
            json.append(quote(buffer.operations().get(index)));
        }
        return json.append("]}").toString();
    }

    private static void execute(DynamicBuffer<Integer> buffer, String command) {
        String[] words = command.split("\\s+");
        switch (words[0]) {
            case "append" -> {
                requireWords(words, 2, "append VALUE");
                buffer.append(parseInteger(words[1], "Value"));
            }
            case "insert" -> {
                requireWords(words, 3, "insert INDEX VALUE");
                buffer.insert(parseInteger(words[1], "Index"), parseInteger(words[2], "Value"));
            }
            case "remove" -> {
                requireWords(words, 2, "remove INDEX");
                buffer.remove(parseInteger(words[1], "Index"));
            }
            case "set" -> {
                requireWords(words, 3, "set INDEX VALUE");
                buffer.set(parseInteger(words[1], "Index"), parseInteger(words[2], "Value"));
            }
            default -> throw new IllegalArgumentException("Use append, insert, remove, or set.");
        }
    }

    private static void requireWords(String[] words, int count, String syntax) {
        if (words.length != count) throw new IllegalArgumentException("Expected " + syntax + ".");
    }

    private static int parseInteger(String value, String label) {
        if (!value.matches("[+-]?[0-9]+")) throw new IllegalArgumentException(label + " must be a signed whole number.");
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException error) {
            throw new IllegalArgumentException(label + " must be between -2147483648 and 2147483647.");
        }
    }

    private static Map<String, String> parseForm(String encoded) {
        Map<String, String> result = new LinkedHashMap<>();
        if (encoded == null || encoded.isEmpty()) return result;
        for (String entry : encoded.split("&", -1)) {
            if (entry.isEmpty()) continue;
            String[] pair = entry.split("=", 2);
            String name = URLDecoder.decode(pair[0], StandardCharsets.UTF_8);
            String value = URLDecoder.decode(pair.length == 2 ? pair[1] : "", StandardCharsets.UTF_8);
            if (result.putIfAbsent(name, value) != null) throw new IllegalArgumentException("Duplicate form field: " + name);
        }
        return result;
    }

    private void sendSources(HttpExchange exchange) throws IOException {
        StringBuilder json = new StringBuilder("[");
        boolean first = true;
        for (String file : sourceContents.keySet()) {
            if (!first) json.append(',');
            first = false;
            json.append("{\"file\":").append(quote(file)).append(",\"label\":")
                    .append(quote(SOURCE_LABELS.get(file))).append('}');
        }
        sendJson(exchange, 200, json.append(']').toString());
    }

    private void sendSource(HttpExchange exchange) throws IOException {
        Map<String, String> query = parseForm(exchange.getRequestURI().getRawQuery());
        String file = query.getOrDefault("file", "");
        if (query.size() != 1 || !sourceContents.containsKey(file)) {
            throw new IllegalArgumentException("Choose a file listed by /api/sources.");
        }
        sendJson(exchange, 200, "{\"file\":" + quote(file) + ",\"content\":" + quote(sourceContents.get(file)) + "}");
    }

    private void sendStatic(HttpExchange exchange, String requestPath) throws IOException {
        if (requestPath.indexOf('\\') >= 0 || requestPath.indexOf('\0') >= 0) {
            sendError(exchange, 404, "Asset not found.");
            return;
        }
        String asset = requestPath.equals("/") ? "index.html" : requestPath.substring(1);
        Path path = webRoot.resolve(asset).normalize();
        if (!path.startsWith(webRoot) || !Files.isRegularFile(path) || !path.toRealPath().startsWith(webRoot)) {
            sendError(exchange, 404, "Asset not found.");
            return;
        }
        String filename = path.getFileName().toString();
        String type = filename.endsWith(".html") ? "text/html; charset=utf-8"
                : filename.endsWith(".css") ? "text/css; charset=utf-8"
                : filename.endsWith(".js") ? "text/javascript; charset=utf-8"
                : filename.endsWith(".svg") ? "image/svg+xml"
                : filename.endsWith(".png") ? "image/png"
                : filename.endsWith(".ico") ? "image/x-icon"
                : "application/octet-stream";
        send(exchange, 200, type, Files.readAllBytes(path));
    }

    private static void sendError(HttpExchange exchange, int status, String message) throws IOException {
        sendJson(exchange, status, "{\"error\":" + quote(message) + "}");
    }

    private static void sendJson(HttpExchange exchange, int status, String json) throws IOException {
        send(exchange, status, "application/json; charset=utf-8", json.getBytes(StandardCharsets.UTF_8));
    }

    private static void send(HttpExchange exchange, int status, String contentType, byte[] bytes) throws IOException {
        exchange.getResponseHeaders().set("Content-Type", contentType);
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
        exchange.getResponseHeaders().set("Content-Security-Policy", "default-src 'self'; script-src 'self'; "
                + "style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; "
                + "object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
        if (exchange.getRequestMethod().equals("HEAD")) {
            exchange.getResponseHeaders().set("Content-Length", String.valueOf(bytes.length));
            exchange.sendResponseHeaders(status, -1);
        } else {
            exchange.sendResponseHeaders(status, bytes.length);
            exchange.getResponseBody().write(bytes);
        }
    }

    private static void appendSnapshot(StringBuilder json, DynamicBuffer.Snapshot<Integer> snapshot, boolean metrics) {
        json.append("{\"slots\":");
        appendNumbers(json, snapshot.slots());
        json.append(",\"size\":").append(snapshot.size()).append(",\"capacity\":").append(snapshot.capacity());
        if (metrics) {
            json.append(",\"metrics\":");
            appendMetrics(json, snapshot.metrics());
        }
        json.append('}');
    }

    private static void appendMetrics(StringBuilder json, DynamicBuffer.Metrics metrics) {
        json.append("{\"writes\":").append(metrics.writes())
                .append(",\"copies\":").append(metrics.copies())
                .append(",\"shifts\":").append(metrics.shifts())
                .append(",\"allocations\":").append(metrics.allocations()).append('}');
    }

    private static void appendNumbers(StringBuilder json, List<Integer> numbers) {
        if (numbers == null) {
            json.append("null");
            return;
        }
        json.append('[');
        for (int index = 0; index < numbers.size(); index++) {
            if (index > 0) json.append(',');
            json.append(numbers.get(index));
        }
        json.append(']');
    }

    private static String quote(String value) {
        StringBuilder json = new StringBuilder("\"");
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            switch (character) {
                case '"' -> json.append("\\\"");
                case '\\' -> json.append("\\\\");
                case '\n' -> json.append("\\n");
                case '\r' -> json.append("\\r");
                case '\t' -> json.append("\\t");
                default -> {
                    if (character < 32) json.append(String.format("\\u%04x", (int) character));
                    else json.append(character);
                }
            }
        }
        return json.append('"').toString();
    }
}
