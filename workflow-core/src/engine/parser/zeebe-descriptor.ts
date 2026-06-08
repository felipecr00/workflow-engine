// Minimal bpmn-moddle descriptor for the subset of the zeebe: namespace we
// support in Phase 1. The naming follows Camunda's public schema reference,
// but no Camunda code is depended on — this is purely an XML schema for
// parsing and serialization.

export const zeebeDescriptor = {
  name: "Zeebe",
  uri: "http://camunda.org/schema/zeebe/1.0",
  prefix: "zeebe",
  xml: { tagAlias: "lowerCase" },
  associations: [],
  types: [
    {
      name: "TaskDefinition",
      superClass: ["Element"],
      properties: [
        { name: "type", isAttr: true, type: "String" },
        { name: "retries", isAttr: true, type: "String", default: "3" },
      ],
    },
    {
      name: "IoMapping",
      superClass: ["Element"],
      properties: [
        { name: "inputParameters", isMany: true, type: "Input" },
        { name: "outputParameters", isMany: true, type: "Output" },
      ],
    },
    {
      name: "Input",
      superClass: ["Element"],
      properties: [
        { name: "source", isAttr: true, type: "String" },
        { name: "target", isAttr: true, type: "String" },
      ],
    },
    {
      name: "Output",
      superClass: ["Element"],
      properties: [
        { name: "source", isAttr: true, type: "String" },
        { name: "target", isAttr: true, type: "String" },
      ],
    },
    {
      name: "AssignmentDefinition",
      superClass: ["Element"],
      properties: [
        { name: "assignee", isAttr: true, type: "String" },
        { name: "candidateGroups", isAttr: true, type: "String" },
        { name: "candidateUsers", isAttr: true, type: "String" },
      ],
    },
  ],
  enumerations: [],
};
