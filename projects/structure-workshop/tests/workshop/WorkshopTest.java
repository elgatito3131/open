package workshop;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** Checks the shared trace/source contract, rather than duplicating engine algorithms. */
public final class WorkshopTest {
    private static int checks;
    private static void check(boolean condition,String label) {
        checks++; if(!condition) throw new AssertionError(label);
    }
    public static void main(String[] args) throws Exception {
        Path root=Path.of(args.length==0?".":args[0]);
        Set<String> ids=new HashSet<>();
        for(Map<String,String> meta:WorkshopServer.LABS) {
            String id=meta.get("id");check(ids.add(id),"unique lab id");
            LabTrace trace=WorkshopServer.runLab(id,meta.get("initial"),meta.get("operations"));
            check(trace.frames().get(0).operationIndex()==-1,"initial state first");
            Path file=meta.get("sourceFile").equals("DynamicBuffer.java")
                ? root.resolve("../array-observatory/src/observatory/DynamicBuffer.java")
                : root.resolve("src/workshop").resolve(meta.get("sourceFile"));
            Map<String,String> markers=new LinkedHashMap<>();
            Pattern pattern=Pattern.compile("// @source ([a-zA-Z0-9_.-]+)");
            for(String line:Files.readAllLines(file)) {
                var match=pattern.matcher(line);
                if(match.find()) {
                    check(markers.put(match.group(1),line)==null,"unique source marker");
                    check(!line.strip().startsWith("//"),"marker on executable code");
                }
            }
            int prior=-1;
            for(LabTrace.Frame frame:trace.frames()) {
                check(frame.operationIndex()>=prior,"operation order");prior=frame.operationIndex();
                check(frame.operationIndex()<trace.operations().size(),"operation index bound");
                check(frame.view().get("layout") instanceof String,"layout");
                if(frame.sourceId()!=null) check(markers.containsKey(frame.sourceId()),"source reference: "+frame.sourceId());
                else check(frame.operationIndex()==-1,"mutations must have source");
                Set<String> nodeIds=new HashSet<>();
                Object nodes=frame.view().get("nodes");
                if(nodes instanceof List<?> list) for(Object value:list) {
                    Map<?,?> node=(Map<?,?>)value;
                    check(nodeIds.add(node.get("id").toString()),"unique visible node IDs");
                }
                Object edges=frame.view().get("edges");
                if(edges instanceof List<?> list) for(Object value:list) {
                    Map<?,?> edge=(Map<?,?>)value;
                    check(nodeIds.contains(edge.get("from"))&&nodeIds.contains(edge.get("to")),"edge endpoints visible");
                }
                String json=WorkshopServer.json(frame.view());check(json.startsWith("{"),"serializable visual snapshot");
            }
        }
        check(ids.size()==5,"five projects");
        check(WorkshopServer.parseForm("x=a%2Bb&empty=").get("x").equals("a+b"),"URL form decoding");
        try { WorkshopServer.parseForm("x=1&x=2");throw new AssertionError("duplicate fields accepted"); }
        catch(IllegalArgumentException expected){checks++;}
        check(WorkshopServer.json("quote\"\\\n\u0001").equals("\"quote\\\"\\\\\\n\\u0001\""),"JSON escaping");
        List<String> mutable=new ArrayList<>(List.of("before"));
        Map<String,Object> visual=new LinkedHashMap<>();visual.put("nested",mutable);
        LabTrace.Frame frozen=new LabTrace.Frame(-1,"","initial","","","",null,visual);
        mutable.add("after");visual.clear();
        check(((List<?>)frozen.view().get("nested")).size()==1,"deep snapshot copy");
        try {frozen.view().clear();throw new AssertionError("mutable view");}catch(UnsupportedOperationException expected){checks++;}
        System.out.println("WorkshopTest passed ("+checks+" checks).");
    }
}
