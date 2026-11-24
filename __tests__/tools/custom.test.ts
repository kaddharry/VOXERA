import { describe, expect, it } from "vitest";
import { customToolDefinitions, customToolFunctionName, executeCustomTool, type CustomToolRow } from "../../lib/tools/custom";

const row: CustomToolRow = {
  id:"a0b1c2d3-e4f5-6789-abcd-ef0123456789",tenant_id:"tenant",name:"Lookup order",description:"Look up an order",endpoint:"https://example.com",method:"POST",
  input_schema:{type:"object",properties:{orderId:{type:"string"}},required:["orderId"]},headers:{},encrypted_secret:null,secret_header:null,status:"active",
};

describe("custom tool registry",()=>{
  it("creates a stable provider-safe function id",()=>expect(customToolFunctionName(row.id)).toBe("custom_a0b1c2d3e4f56789abcdef01"));
  it("only advertises active saved tools with their schemas",()=>{
    const tools=customToolDefinitions([row,{...row,id:"b0b1c2d3-e4f5-6789-abcd-ef0123456789",status:"disabled"}]);
    expect(tools).toHaveLength(1);expect(tools[0].function.name).toBe(customToolFunctionName(row.id));expect(tools[0].function.parameters).toEqual(row.input_schema);
  });
  it("rejects missing and unexpected arguments before contacting endpoints",async()=>{
    await expect(executeCustomTool(row,{})).rejects.toThrow("Missing required input: orderId");
    await expect(executeCustomTool(row,{orderId:"A1",extra:true})).rejects.toThrow("Unexpected input: extra");
  });
  it("rejects non HTTPS endpoints before network access",async()=>{
    await expect(executeCustomTool({...row,endpoint:"http://127.0.0.1:8080"},{orderId:"A1"})).rejects.toThrow("must use HTTPS");
  });
});
