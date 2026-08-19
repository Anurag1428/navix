<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Always re-read files

Always re-read a file immediately before editing or acting on it — file contents may change between reads (the user edits files during sessions). Never rely on a cached version from an earlier read.

## Browserbase observability

Session recordings, replays, live view, and logs come from the core Browserbase SDK
(`@browserbasehq/sdk`) — not Stagehand. Before building any observability feature, consult
Browserbase's observability docs:
https://docs.browserbase.com/platform/browser/observability

Session replay specifically — retrieving a session's recording as an HLS playlist — is
documented here:
https://docs.browserbase.com/platform/browser/observability/session-replay
The retrieval needs the secret API key, so it must be proxied server-side.

# Adding a workflow node

Three edits, all under `features/workflows/nodes/`:

1. the impl file (e.g. `open-url.ts`) — the node's executor logic,
2. register it in `node-executors.ts` — the `satisfies` contract makes a missing
   executor a compile error for action nodes,
3. add its manifest entry in `node-registry.ts` — kind, label, icon, accent, its
   input `fields`, and the `outputs` downstream nodes can reference.

The run task and the canvas step node are registry-driven — never touch them to add
a node.

# React Flow documentation

> React Flow is a library for building interactive, node-based user interfaces such as flowcharts, diagrams, visual programming tools, and workflows. It supports theming, custom nodes and edges, and a library of shadcn UI components.

**Rule:** This project uses ReactFlow (React Flow / `@xyflow/react`) for the canvas. Its APIs, components, hooks, and props change across versions and may differ from your training data. Never rely on memory for component names, props, hook signatures, or usage patterns — instead, consult the documentation below (fetch the linked page relevant to what you're building) before writing or changing any ReactFlow code.

## Guides

- [Quick Start](https://reactflow.dev/learn): React Flow quickstart that shows how to install the package, use it and where to find example apps
- Core Concepts
  - [Overview](https://reactflow.dev/learn/concepts/terms-and-definitions): Learn about the basic terms and definitions of React Flow
  - [Building a Flow](https://reactflow.dev/learn/concepts/building-a-flow): A step-by-step guide to creating your first flow diagram with React Flow. Learn how to set up the canvas, add nodes and edges, and enhance your flow with built-in features like viewport fitting and custom node types.
  - [Adding Interactivity](https://reactflow.dev/learn/concepts/adding-interactivity): This guide will show you how to add basic interactivity to your flow.
  - [The Viewport](https://reactflow.dev/learn/concepts/the-viewport): Learn how to customize the panning and zooming behavior of React Flow.
  - [Built-In Components](https://reactflow.dev/learn/concepts/built-in-components): React Flow comes with several built-in components. Here's an overview of the minimap, controls, background, and panel components.
- Customization
  - [Nodes](https://reactflow.dev/learn/customization/custom-nodes): Custom nodes in React Flow are just React components. This guide shows you how to implement your own nodes.
  - [Handles](https://reactflow.dev/learn/customization/handles): This guide shows you how to add handles to custom nodes in React Flow.
  - [Edges](https://reactflow.dev/learn/customization/custom-edges): Like custom nodes, parts of a custom edge in React Flow are just React components. This guide shows you how to implement a custom edge with some additional controls.
  - [Edge Labels](https://reactflow.dev/learn/customization/edge-labels): This guide shows you how to render custom edge labels onto custom edges in React Flow.
  - [Utility Classes](https://reactflow.dev/learn/customization/utility-classes): This guide gives you an overview of utility classes in React Flow that help you control interactions within custom nodes.
  - [Theming](https://reactflow.dev/learn/customization/theming): React Flow comes with a minimal default theme. It's common to overwrite the default styles with your own CSS or use third-party libraries like TailwindCSS.
- Layouting
  - [Overview](https://reactflow.dev/learn/layouting/layouting): React Flow doesn't include any layouting algorithms out of the box. This guide surveys some of the options out there and shows you how to use them with React Flow.
  - [Sub Flows](https://reactflow.dev/learn/layouting/sub-flows): Learn how to use sub flows to group nodes together in a flow.
- Advanced Use
  - [Hooks and Providers](https://reactflow.dev/learn/advanced-use/hooks-providers): Overview of Hooks and Providers in React Flow.
  - [Accessibility](https://reactflow.dev/learn/advanced-use/accessibility): React Flow is designed to be both keyboard and screen reader accessible.
  - [Testing](https://reactflow.dev/learn/advanced-use/testing): How to test React Flow applications with Cypress, Playwright or Jest.
  - [TypeScript](https://reactflow.dev/learn/advanced-use/typescript): In this guide we explain how to work with React Flow and TypeScript.
  - [Uncontrolled Flow](https://reactflow.dev/learn/advanced-use/uncontrolled-flow): Uncontrolled inputs in React manage their own state internally. This guide shows you how to set up and use an uncontrolled flow.
  - [Performance](https://reactflow.dev/learn/advanced-use/performance): Strategies to optimize React Flow performance for large graphs.
  - [State Management](https://reactflow.dev/learn/advanced-use/state-management): Learn how to use React Flow with a state management library like Zustand, Redux, Recoil or Jotai.
  - [Computing Flows](https://reactflow.dev/learn/advanced-use/computing-flows): Learn how to extend React Flow to compute data going through flow graphs.
  - [Server Side Rendering](https://reactflow.dev/learn/advanced-use/ssr-ssg-configuration): Step-by-step guide render React Flow apps on the server for displaying static flows, dynamically generating images from flows, or rendering graphs in non-javascript environments
  - [Devtools](https://reactflow.dev/learn/advanced-use/devtools-and-debugging): Copy pastable devtools for React Flow
  - [Multiplayer](https://reactflow.dev/learn/advanced-use/multiplayer): Learn how to use React Flow with realtime multiplayer collaboration features.
  - [Whiteboard Features](https://reactflow.dev/learn/advanced-use/whiteboard): Learn how to add drawing capabilities to your React Flow applications, including freehand drawing, rectangle shapes, lasso selection, and erasing.
- Tutorials
  - [Slideshow App](https://reactflow.dev/learn/tutorials/slide-shows-with-react-flow)
  - [Web Audio API](https://reactflow.dev/learn/tutorials/react-flow-and-the-web-audio-api)
  - [Mind Map App](https://reactflow.dev/learn/tutorials/mind-map-app-with-react-flow)
  - [React Flow UI](https://reactflow.dev/learn/tutorials/getting-started-with-react-flow-components)
- Troubleshooting
  - [Common Errors](https://reactflow.dev/learn/troubleshooting/common-errors): Troubleshooting and fixes for common issues with React Flow.
  - [Migrate to v12](https://reactflow.dev/learn/troubleshooting/migrate-to-v12): Use this guide to migrate from React Flow 11 to 12.
  - [Migrate to v11](https://reactflow.dev/learn/troubleshooting/migrate-to-v11): Use this guide to migrate from React Flow v10 to v11.
  - [Migrate to v10](https://reactflow.dev/learn/troubleshooting/migrate-to-v10): Use this guide to migrate from React Flow v9 to v10.

## Examples

- [All Examples](https://reactflow.dev/examples): Overview of React Flow examples for practical copy-paste solutions to common use cases.
- [Pro Examples](https://reactflow.dev/examples/pro-examples): Advanced React Flow code examples to use in your node-based UIs, crafted by the React Flow core team.
- [Feature Overview](https://reactflow.dev/examples/overview): The most used features of React Flow - controls, MiniMap, node types, edge types, edge labels, and custom styling.
- Nodes
  - [Add Node On Edge Drop](https://reactflow.dev/examples/nodes/add-node-on-edge-drop): A new node appears wherever you drop the connection line
  - [Connection Limit](https://reactflow.dev/examples/nodes/connection-limit): Use the `isConnectable` prop to limit the number of connections a handle can have
  - [Custom Nodes](https://reactflow.dev/examples/nodes/custom-node): Display any content inside of a node
  - [Delete Middle Node](https://reactflow.dev/examples/nodes/delete-middle-node): Remove a node without breaking the flow
  - [Drag Handle](https://reactflow.dev/examples/nodes/drag-handle): Restrict dragging to a specific part of node
  - [Easy Connect](https://reactflow.dev/examples/nodes/easy-connect): Make the whole node into a handle
  - [Intersections](https://reactflow.dev/examples/nodes/intersections): Detect when a node overlaps with another node
  - [Node Resizer](https://reactflow.dev/examples/nodes/node-resizer): Change the size of a node with a bounding box or draggable icon
  - [Node Toolbar](https://reactflow.dev/examples/nodes/node-toolbar): A toolbar with buttons appears next to the selected node
  - [Proximity Connect](https://reactflow.dev/examples/nodes/proximity-connect): Automatically create edges when nodes get close to each other
  - [Rotatable Node](https://reactflow.dev/examples/nodes/rotatable-node): A custom node that can be rotated using CSS transforms
  - [Node Position Animation](https://reactflow.dev/examples/nodes/node-position-animation): Animate smooth transitions between different graph layouts with interactive controls
  - [Stress Test](https://reactflow.dev/examples/nodes/stress): Render hundreds of nodes and edges at once
  - [Updating Nodes](https://reactflow.dev/examples/nodes/update-node): Update the data field of a specific node
  - [Shapes](https://reactflow.dev/examples/nodes/shapes): Render Custom Nodes with different shapes that are commonly used in flow charts
- Edges
  - [Animating Edges](https://reactflow.dev/examples/edges/animating-edges): Create edge animations that go beyond the built-in animated edge.
  - [Custom Connection Line](https://reactflow.dev/examples/edges/custom-connectionline): Change the appearance and behavior of the connection line
  - [Custom Edges](https://reactflow.dev/examples/edges/custom-edges): Create edges with special routing or controls along the edge
  - [Delete Edge on Drop](https://reactflow.dev/examples/edges/delete-edge-on-drop): Delete an edge when it doesn't find a handle
  - [Edge Label Renderer](https://reactflow.dev/examples/edges/edge-label-renderer): Render edge labels as divs on top of edges
  - [Edge Intersection](https://reactflow.dev/examples/edges/edge-intersection): Detect edge intersections with nodes while dragging.
  - [Edge Toolbar](https://reactflow.dev/examples/edges/edge-toolbar): You can use the EdgeToolbar component to display content on top of an edge.
  - [Edge Types](https://reactflow.dev/examples/edges/edge-types): Make edges straight, stepped, smooth-stepped, or bezier curved
  - [Edge Routing](https://reactflow.dev/examples/edges/edge-routing): Implement a routable edge with libavoid
  - [Floating Edges](https://reactflow.dev/examples/edges/floating-edges): Instead of having the handle at a fixed point, let it move with the connected edge
  - [Edge Markers](https://reactflow.dev/examples/edges/markers): Make your edges into arrows, add custom icons, or SVGs
  - [Multi Connection Line](https://reactflow.dev/examples/edges/multi-connection-line): Draw multiple connection lines at once from any selected nodes.
  - [Reconnect Edge](https://reactflow.dev/examples/edges/reconnect-edge): Click-drag to move an existing edge from one handle to another
  - [Simple Floating Edges](https://reactflow.dev/examples/edges/simple-floating-edges): Edges connect to the closest available handle
  - [Temporary Edges](https://reactflow.dev/examples/edges/temporary-edges): Push what React Flow edges are capable of by rendering invisible ghost nodes.
  - [Editable Edge](https://reactflow.dev/examples/edges/editable-edge): Implement a custom edge with draggable control points to change the path of an edge
- Interaction
  - [Computing Flows](https://reactflow.dev/examples/interaction/computing-flows): This examples demonstrates how to use the helpers to handle data flow
  - [Connection Events](https://reactflow.dev/examples/interaction/connection-events): React Flow emits different events during the connection process. Use this example to get an overview of those events and what order they are called in.
  - [Context Menu](https://reactflow.dev/examples/interaction/context-menu): Right-click a node to display custom actions
  - [Contextual Zoom](https://reactflow.dev/examples/interaction/contextual-zoom): Only display the content of a node when you are zoomed in close enough
  - [Drag and Drop](https://reactflow.dev/examples/interaction/drag-and-drop): Drag and drop outside of the React Flow pane with native HTML Drag and Drop API or react-draggable.
  - [Preventing Cycles](https://reactflow.dev/examples/interaction/prevent-cycles): Check if a new connection would cause a cycle in the graph
  - [Save and Restore](https://reactflow.dev/examples/interaction/save-and-restore): Save the state of the diagram, and reload it after refreshing the page
  - [Touch Device](https://reactflow.dev/examples/interaction/touch-device): Tap two handles to connect them, and make handles bigger for smaller devices
  - [Validation](https://reactflow.dev/examples/interaction/validation): Check if a new connection is valid and should be added
  - [Helper Lines](https://reactflow.dev/examples/interaction/helper-lines): Display lines that help to visually align nodes, with automatic snapping for precise positioning and layout control.
  - [Collaborative](https://reactflow.dev/examples/interaction/collaborative): Build a collaborative graph for multiple users with React Flow and yjs
  - [Copy and Paste](https://reactflow.dev/examples/interaction/copy-paste): Select nodes and edges to cut, copy, and paste
  - [Undo and Redo](https://reactflow.dev/examples/interaction/undo-redo): Undo and redo functionality for moving, adding, and deleting nodes and edges
- Subflows & Grouping
  - [Selection Grouping](https://reactflow.dev/examples/grouping/selection-grouping): This example demonstrates how to create dynamic node grouping in React Flow.
  - [Parent Child Relation](https://reactflow.dev/examples/grouping/parent-child-relation): Dynamically attach and detach nodes from parent containers with drag and drop functionality
  - [Sub Flow](https://reactflow.dev/examples/grouping/sub-flows): Render nested graphs and group nodes, and configure the behavior of child nodes
- Layout
  - [Dagre Tree](https://reactflow.dev/examples/layout/dagre): Integrate dagre js with React Flow to create simple tree layouts
  - [Elkjs Tree](https://reactflow.dev/examples/layout/elkjs): For a more powerful alternative to dagre, you can also use elkjs to layout your graphs
  - [Elkjs Multiple Handles](https://reactflow.dev/examples/layout/elkjs-multiple-handles): Use multiple handles with the elkjs layouting engine to reduce edge crossings
  - [Horizontal Flow](https://reactflow.dev/examples/layout/horizontal): A diagram that flows from left to right
  - [Expand and Collapse](https://reactflow.dev/examples/layout/expand-collapse): Create hierarchical trees with expandable and collapsible nodes using dagre for automatic layouts
  - [Auto Layout](https://reactflow.dev/examples/layout/auto-layout): Automatically arrange nodes using various layout engines like dagre, d3-hierarchy, or elkjs
  - [Force Layout](https://reactflow.dev/examples/layout/force-layout): Newly added nodes never overlap with existing nodes using d3-force
  - [Dynamic Layouting](https://reactflow.dev/examples/layout/dynamic-layouting): A self-organizing graph where users add nodes by clicking placeholder elements, and nodes position automatically.
  - [Node Collisions](https://reactflow.dev/examples/layout/node-collisions): Automatically resolve node overlaps using collision detection algorithms
- Styling
  - [Base Style](https://reactflow.dev/examples/styling/base-style): Show the bare-bones base style that is built into React Flow, but is not used by default
  - [Dark Mode](https://reactflow.dev/examples/styling/dark-mode): React Flow comes with a color mode prop that allows you to switch between dark, light and system mode.
  - [Tailwind](https://reactflow.dev/examples/styling/tailwind): Use Tailwind CDN to easily make nice looking flows
  - [Turbo Flow](https://reactflow.dev/examples/styling/turbo-flow): Nodes with glowing animated gradient borders, inspired by the turbo.build website
- Whiteboard
  - [Eraser Tool](https://reactflow.dev/examples/whiteboard/eraser): A tool that let's you delete nodes and edges by wiping
  - [Lasso Selection](https://reactflow.dev/examples/whiteboard/lasso-selection): An example about selecting multiple items using a lasso selection tool.
  - [Rectangle](https://reactflow.dev/examples/whiteboard/rectangle): An example about drawing rectangles on a whiteboard using React Flow.
  - [Freehand Draw](https://reactflow.dev/examples/whiteboard/freehand-draw): Freehand drawing on the canvas.
- Misc
  - [Download Image](https://reactflow.dev/examples/misc/download-image): Save a flow as a png with the html-to-image library
  - [Server Side Image Creation](https://reactflow.dev/examples/misc/server-side-image-creation): Generate static images of React Flow graphs on the server with Puppeteer

## API reference

- [API Reference](https://reactflow.dev/api-reference)
- [<ReactFlow />](https://reactflow.dev/api-reference/react-flow)
- [<ReactFlowProvider />](https://reactflow.dev/api-reference/react-flow-provider)
- [Components](https://reactflow.dev/api-reference/components)
  - [<Background />](https://reactflow.dev/api-reference/components/background): The Background component makes it convenient to render different types of backgrounds common in node-based UIs. It comes with three variants: lines, dots and cross.
  - [<BaseEdge />](https://reactflow.dev/api-reference/components/base-edge): The BaseEdge component gets used internally for all the edges. It can be used inside a custom edge and handles the invisible helper edge and the edge label for you.
  - [<ControlButton />](https://reactflow.dev/api-reference/components/control-button): You can add buttons to the control panel by using the ControlButton component and pass it as a child to the Controls component.
  - [<Controls />](https://reactflow.dev/api-reference/components/controls): The Controls component renders a small panel that contains convenient buttons to zoom in, zoom out, fit the view, and lock the viewport.
  - [<EdgeLabelRenderer />](https://reactflow.dev/api-reference/components/edge-label-renderer): Edges are SVG-based. If you want to render more complex labels you can use the EdgeLabelRenderer component to access a div based renderer. This component is a portal that renders the label in a div that is positioned on top of the edges. You can see an example usage of the component in the edge label renderer example.
  - [<EdgeText />](https://reactflow.dev/api-reference/components/edge-text): You can use the EdgeText component as a helper component to display text within your custom edges.
  - [<EdgeToolbar />](https://reactflow.dev/api-reference/components/edge-toolbar): The EdgeToolbar component can render a toolbar or tooltip to one side of a custom edge. This toolbar doesn't scale with the viewport so that the content doesn't get too small when zooming out.
  - [<Handle />](https://reactflow.dev/api-reference/components/handle): The Handle component is used in your custom nodes to define connection points.
  - [<MiniMap />](https://reactflow.dev/api-reference/components/minimap): The MiniMap component can be used to render an overview of your flow. It renders each node as an SVG element and visualizes where the current viewport is in relation to the rest of the flow.
  - [<NodeResizeControl />](https://reactflow.dev/api-reference/components/node-resize-control): To create your own resizing UI, you can use the NodeResizeControl component where you can pass children (such as icons).
  - [<NodeResizer />](https://reactflow.dev/api-reference/components/node-resizer): The NodeResizer component can be used to add a resize functionality to your nodes. It renders draggable controls around the node to resize in all directions.
  - [<NodeToolbar />](https://reactflow.dev/api-reference/components/node-toolbar): The NodeToolbar component can render a toolbar or tooltip to one side of a custom node. This toolbar doesn't scale with the viewport so that the content is always visible.
  - [<Panel />](https://reactflow.dev/api-reference/components/panel): The Panel component helps you position content above the viewport. It is used internally by the MiniMap and Controls components.
  - [<ViewportPortal />](https://reactflow.dev/api-reference/components/viewport-portal): The ViewportPortal component can be used to add components to the same viewport of the flow where nodes and edges are rendered. This is useful when you want to render your own components that are adhere to the same coordinate system as the nodes & edges and are also affected by zooming and panning
- [Hooks](https://reactflow.dev/api-reference/hooks)
  - [useConnection()](https://reactflow.dev/api-reference/hooks/use-connection): The useConnection hook returns the current connection when there is an active connection interaction. If no connection interaction is active, it returns null for every property. A typical use case for this hook is to colorize handles based on a certain condition (e.g. if the connection is valid or not).
  - [useEdges()](https://reactflow.dev/api-reference/hooks/use-edges): This hook returns an array of the current edges. Components that use this hook will re-render whenever any edge changes.
  - [useEdgesState()](https://reactflow.dev/api-reference/hooks/use-edges-state): This hook makes it easy to prototype a controlled flow where you manage the state of nodes and edges outside the ReactFlowInstance. You can think of it like React's `useState` hook with an additional helper callback.
  - [useHandleConnections()](https://reactflow.dev/api-reference/hooks/use-handle-connections): This hook returns an array of the current edges. Components that use this hook will re-render whenever any edge changes.
  - [useInternalNode()](https://reactflow.dev/api-reference/hooks/use-internal-node): This hook returns an InternalNode object for the given node ID.
  - [useKeyPress()](https://reactflow.dev/api-reference/hooks/use-key-press): This hook lets you listen for specific key codes and tells you whether they are currently pressed or not.
  - [useNodeConnections()](https://reactflow.dev/api-reference/hooks/use-node-connections): This hook returns an array of connected edges. Components that use this hook will re-render whenever any edge changes.
  - [useNodeId()](https://reactflow.dev/api-reference/hooks/use-node-id): You can use this hook to get the id of the node it is used inside. It is useful if you need the node's id deeper in the render tree but don't want to manually drill down the id as a prop.
  - [useNodes()](https://reactflow.dev/api-reference/hooks/use-nodes): This hook returns an array of the current nodes. Components that use this hook will re-render whenever any node changes, including when a node is selected or moved.
  - [useNodesData()](https://reactflow.dev/api-reference/hooks/use-nodes-data): With this hook you can subscribe to changes of a node data of a specific node.
  - [useNodesInitialized()](https://reactflow.dev/api-reference/hooks/use-nodes-initialized): This hook tells you whether all the nodes in a flow have been measured and given a width and height. When you add a node to the flow, this hook will return false and then true again once the node has been measured.
  - [useNodesState()](https://reactflow.dev/api-reference/hooks/use-nodes-state): This hook makes it easy to prototype a controlled flow where you manage the state of nodes and edges outside the ReactFlowInstance. You can think of it like React's `useState` hook with an additional helper callback.
  - [useOnSelectionChange()](https://reactflow.dev/api-reference/hooks/use-on-selection-change): This hook lets you listen for changes to both node and edge selection. As the name implies, the callback you provide will be called whenever the selection of either nodes or edges changes.
  - [useOnViewportChange()](https://reactflow.dev/api-reference/hooks/use-on-viewport-change): The useOnViewportChange hook lets you listen for changes to the viewport such as panning and zooming. You can provide a callback for each phase of a viewport change: onStart, onChange, and onEnd.
  - [useReactFlow()](https://reactflow.dev/api-reference/hooks/use-react-flow): This hook returns a ReactFlowInstance that can be used to update nodes and edges, manipulate the viewport, or query the current state of the flow.
  - [useStore()](https://reactflow.dev/api-reference/hooks/use-store): This hook can be used to subscribe to internal state changes of the React Flow component. The useStore hook is re-exported from the Zustand state management library, so you should check out their docs for more details.
  - [useStoreApi()](https://reactflow.dev/api-reference/hooks/use-store-api): In some cases, you might need to access the store directly. This hook returns the store object which can be used on demand to access the state or dispatch actions.
  - [useUpdateNodeInternals()](https://reactflow.dev/api-reference/hooks/use-update-node-internals): When you programmatically add or remove handles to a node or update a node's handle position, you need to let React Flow know about it using this hook. This will update the internal dimensions of the node and properly reposition handles on the canvas if necessary.
  - [useViewport()](https://reactflow.dev/api-reference/hooks/use-viewport): The useViewport hook is a convenient way to read the current state of the Viewport in a component. Components that use this hook will re-render whenever the viewport changes.
- [Types](https://reactflow.dev/api-reference/types)
  - [Align](https://reactflow.dev/api-reference/types/align): The Align type contains the values expected by the align prop of the NodeToolbar component
  - [AriaLabelConfig](https://reactflow.dev/api-reference/types/aria-label-config): With the AriaLabelConfig you can customize the aria labels and descriptions used by React Flow.
  - [BackgroundVariant](https://reactflow.dev/api-reference/types/background-variant): The three variants are exported as an enum for convenience. You can either import the enum and use it like BackgroundVariant.Lines or you can use the raw string value directly.
  - [ColorMode](https://reactflow.dev/api-reference/types/color-mode): The ColorMode type defines the available color modes for the ReactFlow component.
  - [Connection](https://reactflow.dev/api-reference/types/connection): The Connection type is the basic minimal description of an Edge between two nodes. The addEdge util can be used to upgrade a Connection to an Edge.
  - [ConnectionLineComponent](https://reactflow.dev/api-reference/types/connection-line-component): Custom React component for rendering the connection line during edge creation.
  - [ConnectionLineComponentProps](https://reactflow.dev/api-reference/types/connection-line-component-props): If you want to render a custom component for connection lines, you can set the connectionLineComponent prop on the ReactFlow component. The ConnectionLineComponentProps are passed to your custom component.
  - [ConnectionLineType](https://reactflow.dev/api-reference/types/connection-line-type): If you set the connectionLineType prop on your ReactFlow component, it will dictate the style of connection line rendered when creating new edges.
  - [ConnectionMode](https://reactflow.dev/api-reference/types/connection-mode): Specifies the rules for how connections between nodes are established.
  - [ConnectionState](https://reactflow.dev/api-reference/types/connection-state): Data about an ongoing connection.
  - [CoordinateExtent](https://reactflow.dev/api-reference/types/coordinate-extent): A coordinate extent represents two points in a coordinate system: one in the top left corner and one in the bottom right corner. It is used to represent the bounds of nodes in the flow or the bounds of the viewport.
  - [DefaultEdgeOptions](https://reactflow.dev/api-reference/types/default-edge-options): Many properties on an Edge are optional. When a new edge is created, the properties that are not provided will be filled in with the default values passed to the defaultEdgeOptions prop of the ReactFlow component.
  - [DeleteElements](https://reactflow.dev/api-reference/types/delete-elements): DeleteElements deletes nodes and edges from the flow and return the deleted edges and nodes asynchronously.
  - [Edge](https://reactflow.dev/api-reference/types/edge): Where a Connection is the minimal description of an edge between two nodes, an `Edge` is the complete description with everything React Flow needs to know in order to render it.
  - [EdgeChange](https://reactflow.dev/api-reference/types/edge-change): The onEdgesChange callback takes an array of EdgeChange objects that you should use to update your flow's state. The EdgeChange type is a union of four different object types that represent that various ways an edge can change in a flow.
  - [EdgeMarker](https://reactflow.dev/api-reference/types/edge-marker): Edges can optionally have markers at the start and end of an edge. The EdgeMarker type is used to configure those markers! Check the docs for MarkerType for details on what types of edge marker are available.
  - [EdgeMouseHandler](https://reactflow.dev/api-reference/types/edge-mouse-handler): The EdgeMouseHandler type defines the callback function that is called when mouse events occur on an edge.
  - [EdgeProps](https://reactflow.dev/api-reference/types/edge-props): When you implement a custom edge it is wrapped in a component that enables some basic functionality. Your custom edge component receives the following props:
  - [EdgeTypes](https://reactflow.dev/api-reference/types/edge-types): The EdgeTypes type is used to define custom edge types.
  - [FitViewOptions](https://reactflow.dev/api-reference/types/fit-view-options): When calling fitView these options can be used to customize the behavior. For example, the duration option can be used to transform the viewport smoothly over a given amount of time.
  - [Handle](https://reactflow.dev/api-reference/types/handle): Handle attributes like id, position, and type.
  - [HandleConnection](https://reactflow.dev/api-reference/types/handle-connection): The HandleConnection type is a Connection that includes the edgeId.
  - [InternalNode](https://reactflow.dev/api-reference/types/internal-node): The InternalNode is an extension of the base Node type with additional properties React Flow uses internally for rendering.
  - [IsValidConnection](https://reactflow.dev/api-reference/types/is-valid-connection): Function type that determines whether a connection between nodes is valid.
  - [KeyCode](https://reactflow.dev/api-reference/types/key-code): Represents keyboard key codes or combinations.
  - [MarkerType](https://reactflow.dev/api-reference/types/marker-type): Edges may optionally have a marker on either end. The MarkerType type enumerates the options available to you when configuring a given marker.
  - [MiniMapNodeProps](https://reactflow.dev/api-reference/types/mini-map-node-props): The MiniMapNodeProps type defines the properties for nodes in a minimap component.
  - [Node](https://reactflow.dev/api-reference/types/node): The Node type represents everything React Flow needs to know about a given node. Many of these properties can be manipulated both by React Flow or by you, but some such as width and height should be considered read-only.
  - [NodeChange](https://reactflow.dev/api-reference/types/node-change): The onNodesChange callback takes an array of NodeChange objects that you should use to update your flow's state. The NodeChange type is a union of six different object types that represent that various ways an node can change in a flow.
  - [NodeConnection](https://reactflow.dev/api-reference/types/node-connection): The NodeConnection type is a Connection that includes the edgeId.
  - [NodeHandle](https://reactflow.dev/api-reference/types/node-handle): The NodeHandle type is used to define a handle for a node if server side rendering is used.
  - [NodeMouseHandler](https://reactflow.dev/api-reference/types/node-mouse-handler): The NodeMouseHandler type defines the callback function that is called when mouse events occur on a node.
  - [NodeOrigin](https://reactflow.dev/api-reference/types/node-origin): The origin of a Node determines how it is placed relative to its own coordinates.
  - [NodeProps](https://reactflow.dev/api-reference/types/node-props): When you implement a custom node it is wrapped in a component that enables basic functionality like selection and dragging. Your custom node receives the following props:
  - [NodeTypes](https://reactflow.dev/api-reference/types/node-types): The NodeTypes type is used to define custom node types.
  - [OnBeforeDelete](https://reactflow.dev/api-reference/types/on-before-delete): The OnBeforeDelete type defines the callback function that is called before nodes or edges are deleted.
  - [OnConnect](https://reactflow.dev/api-reference/types/on-connect): Callback function triggered when a new connection is created between nodes.
  - [OnConnectEnd](https://reactflow.dev/api-reference/types/on-connect-end): Callback function triggered when finishing or canceling a connection attempt between nodes.
  - [OnConnectStart](https://reactflow.dev/api-reference/types/on-connect-start): Callback function triggered when starting to create a connection between nodes.
  - [OnDelete](https://reactflow.dev/api-reference/types/on-delete): The OnDelete type defines the callback function that is called when nodes or edges are deleted.
  - [OnEdgesChange](https://reactflow.dev/api-reference/types/on-edges-change)
  - [OnEdgesDelete](https://reactflow.dev/api-reference/types/on-edges-delete): The OnEdgesDelete type defines the callback function that is called when edges are deleted.
  - [OnError](https://reactflow.dev/api-reference/types/on-error): The OnError type defines the callback function that is called when an error occurs.
  - [OnInit](https://reactflow.dev/api-reference/types/on-init): The OnInit type defines the callback function that is called when the ReactFlow instance is initialized.
  - [OnMove](https://reactflow.dev/api-reference/types/on-move): Invoked when the viewport is moved, such as by panning or zooming.
  - [OnNodeDrag](https://reactflow.dev/api-reference/types/on-node-drag): The OnNodeDrag type defines the callback function that is called when a node is being dragged.
  - [OnNodesChange](https://reactflow.dev/api-reference/types/on-nodes-change)
  - [OnNodesDelete](https://reactflow.dev/api-reference/types/on-nodes-delete): The OnNodesDelete type defines the callback function that is called when nodes are deleted.
  - [OnReconnect](https://reactflow.dev/api-reference/types/on-reconnect): Callback function triggered when an existing edge is reconnected to a different node or handle.
  - [OnSelectionChangeFunc](https://reactflow.dev/api-reference/types/on-selection-change-func): Called whenever the selection of nodes or edges changes in the flow diagram.
  - [PanOnScrollMode](https://reactflow.dev/api-reference/types/pan-on-scroll-mode): Configures how the viewport responds to scroll events, allowing free, vertical, or horizontal panning.
  - [PanelPosition](https://reactflow.dev/api-reference/types/panel-position): This type is mostly used to help position things on top of the flow viewport. For example both the MiniMap and Controls components take a position prop of this type.
  - [Position](https://reactflow.dev/api-reference/types/position): While PanelPosition can be used to place a component in the corners of a container, the Position enum is less precise and used primarily in relation to edges and handles.
  - [ProOptions](https://reactflow.dev/api-reference/types/pro-options): By default, we render a small attribution in the corner of your flows that links back to the project.
  - [ReactFlowInstance](https://reactflow.dev/api-reference/types/react-flow-instance): The ReactFlowInstance provides a collection of methods to query and manipulate the internal state of your flow. You can get an instance by using the useReactFlow hook or attaching a listener to the onInit event.
  - [ReactFlowJsonObject](https://reactflow.dev/api-reference/types/react-flow-json-object): A JSON-compatible representation of your flow. You can use this to save the flow to a database for example and load it back in later.
  - [Rect](https://reactflow.dev/api-reference/types/rect): The Rect type defines a rectangle with dimensions and a position.
  - [ResizeParams](https://reactflow.dev/api-reference/types/resize-params): The ResizeParams type is used to type the various events that are emitted by the NodeResizer component. You'll sometimes see this type extended with an additional direction field too.
  - [SelectionDragHandler](https://reactflow.dev/api-reference/types/selection-drag-handler): Handles drag events for selected nodes during interactive operations.
  - [SelectionMode](https://reactflow.dev/api-reference/types/selection-mode): Controls how nodes are selected in the flow diagram, offering either full or partial selection behavior.
  - [SnapGrid](https://reactflow.dev/api-reference/types/snap-grid): The SnapGrid type defines the grid size for snapping nodes on the pane.
  - [Viewport](https://reactflow.dev/api-reference/types/viewport): Internally, React Flow maintains a coordinate system that is independent of the rest of the page. The Viewport type tells you where in that system your flow is currently being display at and how zoomed in or out it is.
  - [XYPosition](https://reactflow.dev/api-reference/types/xy-position): All positions are stored in an object with x and y coordinates.
  - [ZIndexMode](https://reactflow.dev/api-reference/types/z-index-mode): The ZIndexMode type is used to define how z-indexing is calculated for nodes and edges.
- [Utils](https://reactflow.dev/api-reference/utils)
  - [addEdge()](https://reactflow.dev/api-reference/utils/add-edge): This util is a convenience function to add a new Edge to an array of edges. It also performs some validation to make sure you don't add an invalid edge or duplicate an existing one.
  - [applyEdgeChanges()](https://reactflow.dev/api-reference/utils/apply-edge-changes): Various events on the ReactFlow component can produce an EdgeChange that describes how to update the edges of your flow in some way. If you don't need any custom behavior, this util can be used to take an array of these changes and apply them to your edges.
  - [applyNodeChanges()](https://reactflow.dev/api-reference/utils/apply-node-changes): Various events on the ReactFlow component can produce a NodeChange that describes how to update the nodes of your flow in some way. If you don't need any custom behavior, this util can be used to take an array of these changes and apply them to your nodes.
  - [getBezierPath()](https://reactflow.dev/api-reference/utils/get-bezier-path): The getBezierPath util returns everything you need to render a bezier edge between two nodes.
  - [getConnectedEdges()](https://reactflow.dev/api-reference/utils/get-connected-edges): Given an array of nodes that may be connected to one another and an array of all your edges, this util gives you an array of edges that connect any of the given nodes together.
  - [getIncomers()](https://reactflow.dev/api-reference/utils/get-incomers): This util is used to tell you what nodes, if any, are connected to the given node as the source of an edge.
  - [getNodesBounds()](https://reactflow.dev/api-reference/utils/get-nodes-bounds): Returns the bounding box that contains all the given nodes in an array. This can be useful when combined with `getViewportForBounds` to calculate the correct transform to fit the given nodes in a viewport.
  - [getOutgoers()](https://reactflow.dev/api-reference/utils/get-outgoers): This util is used to tell you what nodes, if any, are connected to the given node as the target of an edge.
  - [getSimpleBezierPath()](https://reactflow.dev/api-reference/utils/get-simple-bezier-path): The getSimpleBezierPath util returns everything you need to render a simple bezier edge between two nodes.
  - [getSmoothStepPath()](https://reactflow.dev/api-reference/utils/get-smooth-step-path): The getSmoothStepPath util returns everything you need to render a stepped path between two nodes. The borderRadius property can be used to choose how rounded the corners of those steps are.
  - [getStraightPath()](https://reactflow.dev/api-reference/utils/get-straight-path): Calculates the straight line path between two points.
  - [getViewportForBounds()](https://reactflow.dev/api-reference/utils/get-viewport-for-bounds): This util returns the viewport for the given bounds. You might use this to pre-calculate the viewport for a given set of nodes on the server or calculate the viewport for the given bounds _without_ changing the viewport directly.
  - [isEdge()](https://reactflow.dev/api-reference/utils/is-edge): Test whether an object is usable as an Edge. In TypeScript this is a type guard that will narrow the type of whatever you pass in to Edge if it returns true.
  - [isNode()](https://reactflow.dev/api-reference/utils/is-node): Test whether an object is usable as a Node. In TypeScript this is a type guard that will narrow the type of whatever you pass in to Node if it returns true.
  - [reconnectEdge()](https://reactflow.dev/api-reference/utils/reconnect-edge): A handy utility to reconnect an existing Edge with new properties. This searches your edge array for an edge with a matching id and updates its properties with the connection you provide.

## UI (React Flow UI — shadcn components)

Ready-to-use React Flow components built with shadcn/ui and Tailwind CSS. Useful for new projects, MVPs, or when you need to get up and running quickly. Requires shadcn and Tailwind configured in the project; components are installed with `npx shadcn@latest add https://ui.reactflow.dev/component-name` and are not black-boxes — they can be modified and extended.

- [Introduction](https://reactflow.dev/ui): Overview, prerequisites, and usage
- Templates
  - [AI Workflow Editor](https://reactflow.dev/ui/templates/ai-workflow-editor): Full AI workflow editor template
  - [Workflow Editor](https://reactflow.dev/ui/templates/workflow-editor): Full workflow editor template
- Components
  - Node Utilities
    - [Base Node](https://reactflow.dev/ui/components/base-node)
    - [Status Indicator](https://reactflow.dev/ui/components/node-status-indicator)
    - [Appendix](https://reactflow.dev/ui/components/node-appendix)
    - [Tooltip](https://reactflow.dev/ui/components/node-tooltip)
  - Custom Nodes
    - [Database Schema](https://reactflow.dev/ui/components/database-schema-node)
    - [Placeholder](https://reactflow.dev/ui/components/placeholder-node)
    - [Labeled Group](https://reactflow.dev/ui/components/labeled-group-node)
  - Handles
    - [Base Handle](https://reactflow.dev/ui/components/base-handle)
    - [Labeled Handle](https://reactflow.dev/ui/components/labeled-handle)
    - [Button Handle](https://reactflow.dev/ui/components/button-handle)
  - Custom Edges
    - [Edge with Button](https://reactflow.dev/ui/components/button-edge)
    - [Edge with Node Data](https://reactflow.dev/ui/components/data-edge)
    - [Animated SVG Edge](https://reactflow.dev/ui/components/animated-svg-edge)
  - Controls
    - [Node Search](https://reactflow.dev/ui/components/node-search)
    - [Zoom Slider](https://reactflow.dev/ui/components/zoom-slider)
    - [Zoom Select](https://reactflow.dev/ui/components/zoom-select)
  - Misc
    - [DevTools](https://reactflow.dev/ui/components/devtools)

**Important:** React Flow UI supports React 19 and Tailwind 4 — the main React Flow CSS stylesheet must be imported after the shadcn UI stylesheet in `global.css` (e.g. `@layer base { @import "@xyflow/react/dist/style.css"; }`), never in `App.tsx` or files it imports.

# JSX text escaping

Escape apostrophes and quotes in JSX text content — raw `'` and `"` trip the
`react/no-unescaped-entities` lint rule. Use `&apos;` for apostrophes and
`&quot;` for quotes (e.g. `you&apos;re`, `doesn&apos;t`). This applies only to
literal text between JSX tags, not to string attribute values or JS strings.

# Database types

Derive database types from the Drizzle schema — never hand-write custom or partial
shapes for table rows. Export `typeof table.$inferSelect` (and `$inferInsert` when
needed) from `lib/schema.ts` and import it. When a consumer needs only some
columns, narrow with `Pick<Row, ...>` / `Omit<Row, ...>` rather than redeclaring a
literal type. Don't add an insert type where `db.insert(...).values()` already
enforces the shape.

<!-- TRIGGER.DEV SKILLS START -->
## Trigger.dev agent skills

This project has Trigger.dev agent skills installed in `.agents/skills/`. Before writing or changing Trigger.dev code (background tasks, scheduled tasks, realtime, or chat.agent AI agents), load the most relevant skill: `trigger-authoring-chat-agent`, `trigger-authoring-tasks`, `trigger-chat-agent-advanced`, `trigger-getting-started`, `trigger-realtime-and-frontend`.
<!-- TRIGGER.DEV SKILLS END -->

# Stagehand Project

This is a project that uses Stagehand V3, a browser automation framework with AI-powered `act`, `extract`, `observe`, and `agent` methods.

The main class can be imported as `Stagehand` from `@browserbasehq/stagehand`.

**Key Classes:**

- `Stagehand`: Main orchestrator class providing `act`, `extract`, `observe`, and `agent` methods
- `context`: A `V3Context` object that manages browser contexts and pages
- `page`: Individual page objects accessed via `stagehand.context.pages()[i]` or created with `stagehand.context.newPage()`

## Initialize

```typescript
import { Stagehand } from "@browserbasehq/stagehand";

const stagehand = new Stagehand({
  env: "LOCAL", // or "BROWSERBASE"
  verbose: 2, // 0, 1, or 2
  model: "openai/gpt-4.1-mini", // or any supported model
});

await stagehand.init();

// Access the browser context and pages
const page = stagehand.context.pages()[0];
const context = stagehand.context;

// Create new pages if needed
const page2 = await stagehand.context.newPage();
```

## Act

Actions are called on the `stagehand` instance (not the page). Use atomic, specific instructions:

```typescript
// Act on the current active page
await stagehand.act("click the sign in button");

// Act on a specific page (when you need to target a page that isn't currently active)
await stagehand.act("click the sign in button", { page: page2 });
```

**Important:** Act instructions should be atomic and specific:

- ✅ Good: "Click the sign in button" or "Type 'hello' into the search input"
- ❌ Bad: "Order me pizza" or "Type in the search bar and hit enter" (multi-step)

### Observe + Act Pattern (Recommended)

Cache the results of `observe` to avoid unexpected DOM changes:

```typescript
const instruction = "Click the sign in button";

// Get candidate actions
const actions = await stagehand.observe(instruction);

// Execute the first action
await stagehand.act(actions[0]);
```

To target a specific page:

```typescript
const actions = await stagehand.observe("select blue as the favorite color", {
  page: page2,
});
await stagehand.act(actions[0], { page: page2 });
```

## Extract

Extract data from pages using natural language instructions. The `extract` method is called on the `stagehand` instance.

### Basic Extraction (with schema)

```typescript
import { z } from "zod";

// Extract with explicit schema
const data = await stagehand.extract(
  "extract all apartment listings with prices and addresses",
  z.object({
    listings: z.array(
      z.object({
        price: z.string(),
        address: z.string(),
      }),
    ),
  }),
);

console.log(data.listings);
```

### Simple Extraction (without schema)

```typescript
// Extract returns a default object with 'extraction' field
const result = await stagehand.extract("extract the sign in button text");

console.log(result);
// Output: { extraction: "Sign in" }

// Or destructure directly
const { extraction } = await stagehand.extract(
  "extract the sign in button text",
);
console.log(extraction); // "Sign in"
```

### Targeted Extraction

Extract data from a specific element using a selector:

```typescript
const reason = await stagehand.extract(
  "extract the reason why script injection fails",
  z.string(),
  { selector: "/html/body/div[2]/div[3]/iframe/html/body/p[2]" },
);
```

### URL Extraction

When extracting links or URLs, use `z.string().url()`:

```typescript
const { links } = await stagehand.extract(
  "extract all navigation links",
  z.object({
    links: z.array(z.string().url()),
  }),
);
```

### Extracting from a Specific Page

```typescript
// Extract from a specific page (when you need to target a page that isn't currently active)
const data = await stagehand.extract(
  "extract the placeholder text on the name field",
  { page: page2 },
);
```

## Observe

Plan actions before executing them. Returns an array of candidate actions:

```typescript
// Get candidate actions on the current active page
const [action] = await stagehand.observe("Click the sign in button");

// Execute the action
await stagehand.act(action);
```

Observing on a specific page:

```typescript
// Target a specific page (when you need to target a page that isn't currently active)
const actions = await stagehand.observe("find the next page button", {
  page: page2,
});
await stagehand.act(actions[0], { page: page2 });
```

## Agent

Use the `agent` method to autonomously execute complex, multi-step tasks.

### Basic Agent Usage

```typescript
const page = stagehand.context.pages()[0];
await page.goto("https://www.google.com");

const agent = stagehand.agent({
  model: "google/gemini-2.0-flash",
  executionModel: "google/gemini-2.0-flash",
});

const result = await agent.execute({
  instruction: "Search for the stock price of NVDA",
  maxSteps: 20,
});

console.log(result.message);
```

### Computer Use Agent (CUA)

For more advanced scenarios using computer-use models:

```typescript
const agent = stagehand.agent({
  mode: "cua", // Enable Computer Use Agent mode
  model: "anthropic/claude-sonnet-4-6",
  // or "google/gemini-2.5-computer-use-preview-10-2025"
  systemPrompt: `You are a helpful assistant that can use a web browser.
    Do not ask follow up questions, the user will trust your judgement.`,
});

await agent.execute({
  instruction: "Apply for a library card at the San Francisco Public Library",
  maxSteps: 30,
});
```

### Agent with Custom Model Configuration

```typescript
const agent = stagehand.agent({
  mode: "cua",
  model: {
    modelName: "google/gemini-2.5-computer-use-preview-10-2025",
    apiKey: process.env.GEMINI_API_KEY,
  },
  systemPrompt: `You are a helpful assistant.`,
});
```

### Agent with Integrations (MCP/External Tools)

```typescript
const agent = stagehand.agent({
  integrations: [`https://mcp.exa.ai/mcp?exaApiKey=${process.env.EXA_API_KEY}`],
  systemPrompt: `You have access to the Exa search tool.`,
});
```

## Advanced Features

### DeepLocator (XPath Targeting)

Target specific elements across shadow DOM and iframes:

```typescript
await page
  .deepLocator("/html/body/div[2]/div[3]/iframe/html/body/p")
  .highlight({
    durationMs: 5000,
    contentColor: { r: 255, g: 0, b: 0 },
  });
```

### Multi-Page Workflows

```typescript
const page1 = stagehand.context.pages()[0];
await page1.goto("https://example.com");

const page2 = await stagehand.context.newPage();
await page2.goto("https://example2.com");

// Act/extract/observe operate on the current active page by default
// Pass { page } option to target a specific page
await stagehand.act("click button", { page: page1 });
await stagehand.extract("get title", { page: page2 });
```