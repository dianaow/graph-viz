# Graph/Network Visualization Library (2024 update)

#### This library is created with D3.js (particularly the d3-force modules) and is meant to be flexible across all datasets with customizable node and edge style.

<br>

### How to use this graph library:

**In the package.json of your application, add this:**
```
  "dependencies": {
    "graph-viz": "github:dianaow/energy-graph-viz",
    "vite": "^5.0.10"
  }
```

**Execute the function to generate a new network, specifying the correct data properies and desired style attributes.**
```
  import ForceGraph from "graph-viz";

  const graph = ForceGraph(
    { nodes, links },
    {
      containerSelector: "#app",
      nodeId: "entity",
      sourceId: "Subject",
      targetId: "Object",
      width: window.innerWidth,
      height: window.innerHeight,
      nodeStyles: {
        strokeWidth: 2
      },
      linkStyles: {
        strokeWidth: 1.5,
      },
      labelStyles: {
        visibility: 'visible',
        label: "entity",
        edge: {
          visibility: 'hidden',
          label: "Relation",
        }
      },
      containerStyles: {
        //"theme": 'light',
        "background-color": '#212121'
      }
    }
  );
```


**Sample data structure**
```
const nodes = [
  {
      "entity": "sustainable energy",
      "category": "concept"
  },
  {
      "entity": "Solar power",
      "category": "Renewable energy"
  },
  {
      "entity": "Wind power",
      "category": "Renewable energy"
  }
]

const links = [
  {
      "Object": "Solar power",
      "Subject": "sustainable energy",
      "Relation": "provides"
  },
  {
      "Object": "Wind power",
      "Subject": "sustainable energy",
      "Relation": "generates"
  }
]
```
