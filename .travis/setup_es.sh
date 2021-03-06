curl -XPUT localhost:9200/default -d '{"mappings": { "_default_": { "dynamic_templates": [
                                                                             {
                                                                                 "string_template": {
                                                                                     "mapping": {
                                                                                         "index": "not_analyzed",
                                                                                         "type": "string"
                                                                                     },
                                                                                     "match_mapping_type": "string",
                                                                                     "match": "*"
                                                                                 }
                                                                             }
                                                                         ]
                                                                     }
                                                                 },
                                                                 "settings": {
                                                                     "index": {
                                                                         "number_of_replicas": "1",
                                                                         "number_of_shards": "1"
                                                                     }
                                                                 }
                                                             }'